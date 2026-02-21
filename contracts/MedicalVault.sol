// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MedicalVaultNFT is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    // Mapping to prevent duplicate records (SHA-256 Hash -> TokenID)
    mapping(bytes32 => uint256) public recordHashes;

    // Access Control: TokenID -> Doctor Address -> Expiry Timestamp
    mapping(uint256 => mapping(address => uint256)) public accessExpiry;

    event RecordMinted(address indexed patient, uint256 tokenId, bytes32 fileHash);
    event AccessGranted(uint256 indexed tokenId, address indexed doctor, uint256 expiry);

    constructor() ERC721("MedicaVault", "MED") Ownable(msg.sender) {}

    /**
     * @dev Phase 3: Minting the record to the Patient's Smart Account
     */
    function mintRecord(address patient, string memory cid, bytes32 fileHash) external returns (uint256) {
        require(recordHashes[fileHash] == 0, "Record hash already exists on-chain");
        
        uint256 tokenId = ++_nextTokenId;
        _safeMint(patient, tokenId);
        _setTokenURI(tokenId, cid);
        recordHashes[fileHash] = tokenId;

        emit RecordMinted(patient, tokenId, fileHash);
        return tokenId;
    }

    /**
     * @dev Phase 4: Granting "Viewer" role to a Doctor address
     */
    function grantViewerRole(uint256 tokenId, address doctor, uint256 durationInSeconds) external {
        require(ownerOf(tokenId) == msg.sender, "Only the patient can grant access");
        
        uint256 expiry = block.timestamp + durationInSeconds;
        accessExpiry[tokenId][doctor] = expiry;

        emit AccessGranted(tokenId, doctor, expiry);
    }

    /**
     * @dev Logic for the dApp to verify if the Doctor currently has access
     */
    function hasAccess(uint256 tokenId, address doctor) public view returns (bool) {
        return block.timestamp <= accessExpiry[tokenId][doctor];
    }
}