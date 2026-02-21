// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MedicalVault.sol";

contract MedicalVaultTest is Test {
    MedicalVaultNFT public vault;

    // Simulated actors from your diagram
    address public patient = address(0x123);
    address public doctor = address(0x456);
    address public hacker = address(0x789);

    function setUp() public {
        // Deploy the contract
        vault = new MedicalVaultNFT();
    }

    /// @dev Tests Phase 3: Tokenization
    function testMinting() public {
        bytes32 fileHash = keccak256("medical_record_data");
        string memory cid = "ipfs://QmPatientRecord123";

        // Mint the record to the patient
        vault.mintRecord(patient, cid, fileHash);

        // Assertions
        assertEq(vault.ownerOf(1), patient);
        assertEq(vault.tokenURI(1), cid);
    }

    /// @dev Tests Phase 4: Access Control (Viewer Role)
    function testGrantAccess() public {
        bytes32 fileHash = keccak256("medical_record_data");
        vault.mintRecord(patient, "ipfs://cid", fileHash);

        // Switch to Patient's perspective (prank)
        vm.prank(patient);
        vault.grantViewerRole(1, doctor, 1 hours);

        // Verify doctor has access
        assertTrue(vault.hasAccess(1, doctor));
    }

    /// @dev Negative Test: Ensures only the patient can grant access
    function test_HackerGrantsAccess() public {
        bytes32 fileHash = keccak256("medical_record_data");
        vault.mintRecord(patient, "ipfs://cid", fileHash);

        vm.expectRevert("Only the patient can grant access");
        // Hacker tries to grant themselves access
        vm.prank(hacker);
        vault.grantViewerRole(1, hacker, 1 hours); // This should revert
    }

    /// @dev Tests the time-lock expiry from your diagram
    function testAccessExpiry() public {
        bytes32 fileHash = keccak256("medical_record_data");
        vault.mintRecord(patient, "ipfs://cid", fileHash);

        vm.prank(patient);
        vault.grantViewerRole(1, doctor, 1 hours);

        // Fast forward time by 1 hour and 1 second
        skip(3601);

        // Verify doctor no longer has access
        assertFalse(vault.hasAccess(1, doctor));
    }
}