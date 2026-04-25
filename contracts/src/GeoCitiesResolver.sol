// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// AUDIT STATUS: NOT AUDITED. Sepolia only.
//
// GeoCitiesResolver — an EIP-3668 (CCIP-Read) wildcard resolver for *.geocities.eth.
// ENSIP-10 (IExtendedResolver) compliant. The on-chain contract holds nothing but a
// signer key and a list of gateway URLs; all subdomain records live off-chain on the
// gateway, which signs answers with the rotatable signer key. The resolver verifies
// the signature in `resolveWithProof` and refuses anything stale.

interface IExtendedResolver {
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory);
}

interface IERC165 {
    function supportsInterface(bytes4 interfaceID) external view returns (bool);
}

/// @notice Reverted by `resolve` to instruct the client to perform an off-chain HTTP lookup
///         per EIP-3668. The client will POST `callData` to one of `urls` and then call
///         `callbackFunction(response, extraData)` on `sender` with the gateway response.
error OffchainLookup(
    address sender,
    string[] urls,
    bytes callData,
    bytes4 callbackFunction,
    bytes extraData
);

contract GeoCitiesResolver is IExtendedResolver, IERC165 {
    address public owner;
    address public signer;
    string[] public gatewayUrls;

    event SignerChanged(address indexed previousSigner, address indexed newSigner);
    event GatewayUrlsChanged(string[] urls);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "GC: not owner");
        _;
    }

    constructor(address _signer, string[] memory _urls) {
        owner = msg.sender;
        signer = _signer;
        gatewayUrls = _urls;
        emit OwnerTransferred(address(0), msg.sender);
        emit SignerChanged(address(0), _signer);
        emit GatewayUrlsChanged(_urls);
    }

    // --- admin ---

    function setSigner(address _signer) external onlyOwner {
        emit SignerChanged(signer, _signer);
        signer = _signer;
    }

    function setGatewayUrls(string[] calldata _urls) external onlyOwner {
        gatewayUrls = _urls;
        emit GatewayUrlsChanged(_urls);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "GC: zero owner");
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }

    // --- ENSIP-10 / EIP-3668 ---

    /// @notice Always reverts with OffchainLookup. The gateway answers and the client
    ///         then calls `resolveWithProof(response, extraData)` to verify.
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        override
        returns (bytes memory)
    {
        bytes memory callData = abi.encodeWithSelector(
            IExtendedResolver.resolve.selector,
            name,
            data
        );
        // extraData carries the original (name, data) so the callback can re-verify
        // exactly what was asked, defending against a gateway swapping in another query.
        bytes memory extraData = abi.encode(name, data);
        revert OffchainLookup(
            address(this),
            gatewayUrls,
            callData,
            this.resolveWithProof.selector,
            extraData
        );
    }

    /// @notice EIP-3668 callback. Decodes `(result, expires, signature)`, checks freshness,
    ///         and verifies the signer over the EIP-191 personal-digest binding the
    ///         resolver address, expiration, the original request and the answer.
    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory)
    {
        (bytes memory result, uint64 expires, bytes memory signature) =
            abi.decode(response, (bytes, uint64, bytes));

        require(block.timestamp <= expires, "GC: signed answer expired");

        // The 0x1900 prefix is the EIP-191 "intended validator" version; this binds the
        // signature to *this resolver* so a sig minted for one resolver can't be replayed
        // against another. Hash inputs must byte-for-byte match what the gateway packed.
        bytes32 digest = keccak256(
            abi.encodePacked(
                bytes2(0x1900),
                address(this),
                expires,
                keccak256(extraData),
                keccak256(result)
            )
        );

        address recovered = _recover(digest, signature);
        require(recovered == signer, "GC: bad signer");

        return result;
    }

    // --- ERC-165 ---

    function supportsInterface(bytes4 interfaceID) external pure override returns (bool) {
        return
            interfaceID == type(IExtendedResolver).interfaceId || // 0x9061b923
            interfaceID == type(IERC165).interfaceId;             // 0x01ffc9a7
    }

    // --- ECDSA recover ---

    /// @dev Inline-asm recover of a 65-byte (r || s || v) signature. We accept v in either
    ///      {0,1} or {27,28}; we reject the malleable upper-half of s per EIP-2.
    function _recover(bytes32 digest, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "GC: bad sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "GC: bad v");
        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "GC: malleable s"
        );
        address a = ecrecover(digest, v, r, s);
        require(a != address(0), "GC: recover failed");
        return a;
    }
}
