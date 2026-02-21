import { network } from "hardhat";

const { viem, networkName } = await network.connect();
const client = await viem.getPublicClient();

console.log(`Deploying MediVault to ${networkName}...`);

const mediVault = await viem.deployContract("MedicalVaultNFT");

console.log("MediVault address:", mediVault.address);


/**
Deploying MediVault to localhost...
MediVault address: 0x5fbdb2315678afecb367f032d93f642f64180aa3
 */