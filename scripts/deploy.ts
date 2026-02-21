import { network } from "hardhat";

const { viem, networkName } = await network.connect();
const client = await viem.getPublicClient();

console.log(`Deploying MediVault to ${networkName}...`);

const mediVault = await viem.deployContract("MedicalVaultNFT");

console.log("MediVault address:", mediVault.address);


/**
Deploying MediVault to localhost...
MediVault address: 0xe7f1725e7734ce288f8367e1bb143e90bb3f0512
 */