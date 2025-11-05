# ⚡ Decentralized Grid Infrastructure Management

Welcome to a revolutionary Web3 solution for managing electrical grid infrastructure! This project decentralizes asset tracking and maintenance by tokenizing contracts on the Stacks blockchain using Clarity smart contracts. It addresses real-world problems like inefficient centralized maintenance, lack of transparency in funding, and delayed repairs in power grids, enabling community-driven funding, verifiable work, and incentivized participation.

## ✨ Features

🔌 Register and track grid assets (e.g., transformers, power lines) immutably  
💰 Tokenize maintenance contracts as NFTs for crowdfunding and execution  
📊 Real-time staking and reward distribution for maintainers  
🗳️ Governance voting for infrastructure decisions  
🔍 Oracle integration for verifying real-world maintenance completion  
⚖️ Dispute resolution mechanism to handle conflicts  
💸 Automated payments and refunds based on contract milestones  
📈 Analytics dashboard data fed from on-chain events  

## 🛠 How It Works

This project leverages 8 Clarity smart contracts to create a robust decentralized system. Here's a high-level overview:

### Smart Contracts Overview
1. **AssetRegistry.clar**: Registers grid assets with unique IDs, owners, and metadata (e.g., location, condition). Prevents duplicates and allows updates only by authorized parties.
2. **GridToken.clar**: Manages the ERC-20-like utility token (GRID) used for staking, payments, and rewards.
3. **MaintenanceFactory.clar**: Deploys new tokenized maintenance contracts as NFTs, defining scope, budget, timelines, and milestones.
4. **StakingPool.clar**: Allows users to stake GRID tokens to fund specific maintenance contracts, earning yields based on completion.
5. **GovernanceDAO.clar**: Handles proposals and voting on grid upgrades, using staked tokens for weighted votes.
6. **OracleVerifier.clar**: Integrates off-chain oracles to confirm maintenance tasks (e.g., via IoT sensors or third-party audits) and trigger events.
7. **RewardDistributor.clar**: Automatically distributes rewards to maintainers and stakers upon verified completion, with slashing for failures.
8. **DisputeResolver.clar**: Enables arbitration for disputes, with escrow holds and community or expert resolution.

**For Grid Operators/Asset Owners**  
- Register assets via `AssetRegistry` with details like GPS coordinates and initial condition hash.  
- Create a maintenance contract using `MaintenanceFactory`, specifying requirements (e.g., "Repair 10km power line") and tokenizing it as an NFT.  
- Fund it partially and open for community staking through `StakingPool`.  

**For Maintainers/Contractors**  
- Bid on tokenized contracts by staking commitment tokens.  
- Upon selection, perform work and submit proof (e.g., photos/hashes) to `OracleVerifier`.  
- Receive automated payouts from `RewardDistributor` once verified.  

**For Investors/Community Members**  
- Stake GRID tokens in `StakingPool` to crowdfund contracts and earn rewards.  
- Participate in `GovernanceDAO` votes to influence grid priorities.  
- Monitor progress and resolve issues via `DisputeResolver` if needed.  

That's it! This system ensures transparent, efficient grid maintenance, reducing downtime and costs while empowering decentralized participation. Deploy on Stacks for Bitcoin-secured transactions.