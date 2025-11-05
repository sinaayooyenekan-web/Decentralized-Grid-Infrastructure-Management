import { describe, it, expect, beforeEach } from "vitest";
import { ClarityValue, uintCV, stringAsciiCV, stringUtf8CV, listCV, someCV, noneCV, tupleCV, bufferCV } from "@stacks/transactions";

const ERR_UNAUTHORIZED = 100;
const ERR_ASSET_NOT_FOUND = 101;
const ERR_INVALID_BUDGET = 102;
const ERR_INVALID_TIMELINE = 103;
const ERR_INVALID_MILESTONES = 104;
const ERR_CONTRACT_EXISTS = 105;
const ERR_INVALID_STATUS = 106;
const ERR_MILESTONE_NOT_FOUND = 107;
const ERR_STAKING_NOT_INITIALIZED = 108;
const ERR_INVALID_NFT_ID = 109;
const ERR_ORACLE_NOT_SET = 110;
const ERR_REWARD_NOT_SET = 111;
const ERR_INVALID_OWNER = 112;
const ERR_CONTRACT_CLOSED = 113;

interface Contract {
  "asset-id": bigint;
  title: string;
  description: string;
  budget: bigint;
  "start-block": bigint;
  "end-block": bigint;
  creator: string;
  status: string;
  "total-staked": bigint;
  "total-rewards": bigint;
}

interface Milestone {
  id: bigint;
  name: string;
  description: string;
  "payout-percent": bigint;
  verified: boolean;
  "verified-at": ClarityValue | null;
}

interface MaintenanceFactoryState {
  nextContractId: bigint;
  oracleContract: string | null;
  rewardDistributor: string | null;
  stakingPoolContract: string | null;
  contracts: Map<bigint, Contract>;
  contractMilestones: Map<bigint, Milestone[]>;
  milestoneCounter: Map<bigint, bigint>;
  nftOwner: Map<bigint, string>;
  prints: Array<{ [key: string]: any }>;
}

class MaintenanceFactoryMock {
  state: MaintenanceFactoryState;
  blockHeight: bigint;
  caller: string;
  owner: string;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextContractId: 0n,
      oracleContract: null,
      rewardDistributor: null,
      stakingPoolContract: null,
      contracts: new Map(),
      contractMilestones: new Map(),
      milestoneCounter: new Map(),
      nftOwner: new Map(),
      prints: [],
    };
    this.blockHeight = 100n;
    this.caller = "ST1CALLER";
    this.owner = "ST1OWNER";
  }

  private assertOwner() {
    return this.caller === this.owner;
  }

  private validateBudget(budget: bigint): { ok: true } | { ok: false; value: number } {
    return budget > 0n ? { ok: true } : { ok: false, value: ERR_INVALID_BUDGET };
  }

  private validateTimeline(start: bigint, end: bigint): { ok: true } | { ok: false; value: number } {
    return start >= this.blockHeight && end > start ? { ok: true } : { ok: false, value: ERR_INVALID_TIMELINE };
  }

  private validatePayouts(payouts: bigint[]): { ok: true } | { ok: false; value: number } {
    const total = payouts.reduce((a, b) => a + b, 0n);
    return total === 100n ? { ok: true } : { ok: false, value: ERR_INVALID_MILESTONES };
  }

  setOracle(newOracle: string): { ok: boolean; value: boolean } {
    if (!this.assertOwner()) return { ok: false, value: false };
    this.state.oracleContract = newOracle;
    return { ok: true, value: true };
  }

  setRewardDistributor(distributor: string): { ok: boolean; value: boolean } {
    if (!this.assertOwner()) return { ok: false, value: false };
    this.state.rewardDistributor = distributor;
    return { ok: true, value: true };
  }

  setStakingPool(pool: string): { ok: boolean; value: boolean } {
    if (!this.assertOwner()) return { ok: false, value: false };
    this.state.stakingPoolContract = pool;
    return { ok: true, value: true };
  }

  createMaintenanceContract(
    assetId: bigint,
    title: string,
    description: string,
    budget: bigint,
    durationBlocks: bigint,
    milestoneNames: string[],
    milestoneDescs: string[],
    milestonePayouts: bigint[]
  ): { ok: boolean; value: bigint | number } {
    if (!this.state.oracleContract) return { ok: false, value: ERR_ORACLE_NOT_SET };
    if (!this.state.rewardDistributor) return { ok: false, value: ERR_REWARD_NOT_SET };
    if (!this.state.stakingPoolContract) return { ok: false, value: ERR_STAKING_NOT_INITIALIZED };

    const budgetRes = this.validateBudget(budget);
    if (!budgetRes.ok) return { ok: false, value: budgetRes.value };

    const start = this.blockHeight + 1n;
    const end = start + durationBlocks;
    const timelineRes = this.validateTimeline(start, end);
    if (!timelineRes.ok) return { ok: false, value: timelineRes.value };

    if (milestoneNames.length === 0 || milestoneNames.length > 10) return { ok: false, value: ERR_INVALID_MILESTONES };
    const payoutRes = this.validatePayouts(milestonePayouts);
    if (!payoutRes.ok) return { ok: false, value: payoutRes.value };

    const id = this.state.nextContractId;
    const contract: Contract = {
      "asset-id": assetId,
      title,
      description,
      budget,
      "start-block": start,
      "end-block": end,
      creator: this.caller,
      status: "open",
      "total-staked": 0n,
      "total-rewards": 0n,
    };

    this.state.contracts.set(id, contract);
    this.state.milestoneCounter.set(id, BigInt(milestoneNames.length));

    const milestones: Milestone[] = milestoneNames.map((name, i) => ({
      id: BigInt(i),
      name: name,
      description: milestoneDescs[i],
      "payout-percent": milestonePayouts[i],
      verified: false,
      "verified-at": null,
    })).slice(0, milestoneNames.length);

    this.state.contractMilestones.set(id, milestones);
    this.state.nftOwner.set(id, this.caller);
    this.state.prints.push({ event: "contract-created", id, asset: assetId });
    this.state.nextContractId += 1n;

    return { ok: true, value: id };
  }

  getContract(id: bigint): Contract | null {
    return this.state.contracts.get(id) || null;
  }

  getMilestones(id: bigint): Milestone[] | null {
    return this.state.contractMilestones.get(id) || null;
  }

  updateContractStatus(id: bigint, newStatus: string): { ok: boolean; value: boolean | number } {
    const contract = this.state.contracts.get(id);
    if (!contract) return { ok: false, value: ERR_CONTRACT_EXISTS };
    if (contract.creator !== this.caller) return { ok: false, value: ERR_UNAUTHORIZED };
    if (!["open", "active", "closed"].includes(newStatus)) return { ok: false, value: ERR_INVALID_STATUS };

    this.state.contracts.set(id, { ...contract, status: newStatus });
    return { ok: true, value: true };
  }

  verifyMilestone(contractId: bigint, milestoneId: bigint): { ok: boolean; value: boolean | number } {
    const contract = this.state.contracts.get(contractId);
    if (!contract) return { ok: false, value: ERR_CONTRACT_EXISTS };
    if (contract.status !== "active") return { ok: false, value: ERR_CONTRACT_CLOSED };

    const milestones = this.state.contractMilestones.get(contractId);
    if (!milestones) return { ok: false, value: ERR_MILESTONE_NOT_FOUND };
    const milestone = milestones[Number(milestoneId)];
    if (!milestone) return { ok: false, value: ERR_MILESTONE_NOT_FOUND };
    if (milestone.verified) return { ok: false, value: ERR_INVALID_STATUS };

    const updated = [...milestones];
    updated[Number(milestoneId)] = { ...milestone, verified: true, "verified-at": someCV(uintCV(this.blockHeight)) };
    this.state.contractMilestones.set(contractId, updated);
    this.state.prints.push({ event: "milestone-verified", contract: contractId, milestone: milestoneId });

    return { ok: true, value: true };
  }

  closeContract(id: bigint): { ok: boolean; value: boolean | number } {
    const contract = this.state.contracts.get(id);
    if (!contract) return { ok: false, value: ERR_CONTRACT_EXISTS };
    const isRewardDistributor = this.state.rewardDistributor === this.caller;
    if (contract.creator !== this.caller && !isRewardDistributor) return { ok: false, value: ERR_UNAUTHORIZED };
    if (this.blockHeight <= contract["end-block"]) return { ok: false, value: ERR_INVALID_TIMELINE };

    this.state.contracts.set(id, { ...contract, status: "closed" });
    return { ok: true, value: true };
  }
}

describe("MaintenanceFactory", () => {
  let mock: MaintenanceFactoryMock;

  beforeEach(() => {
    mock = new MaintenanceFactoryMock();
    mock.reset();
    mock.owner = mock.caller;
  });

  it("sets oracle, reward, and staking contracts", () => {
    expect(mock.setOracle("ST2ORACLE").ok).toBe(true);
    expect(mock.setRewardDistributor("ST2REWARD").ok).toBe(true);
    expect(mock.setStakingPool("ST2POOL").ok).toBe(true);
    expect(mock.state.oracleContract).toBe("ST2ORACLE");
  });

  it("creates maintenance contract with valid milestones", () => {
    mock.setOracle("ST2ORACLE");
    mock.setRewardDistributor("ST2REWARD");
    mock.setStakingPool("ST2POOL");

    const result = mock.createMaintenanceContract(
      101n,
      "Fix Transformer",
      "Repair high-voltage transformer",
      5000000n,
      1440n,
      ["Inspect", "Replace Parts", "Test"],
      ["Site inspection", "Component swap", "Safety test"],
      [30n, 50n, 20n]
    );

    expect(result.ok).toBe(true);
    expect(result.value).toBe(0n);

    const contract = mock.getContract(0n);
    expect(contract?.title).toBe("Fix Transformer");
    expect(contract?.budget).toBe(5000000n);
    expect(contract?.status).toBe("open");

    const milestones = mock.getMilestones(0n);
    expect(milestones?.length).toBe(3);
    expect(milestones?.[0].name).toBe("Inspect");
    expect(milestones?.[0]["payout-percent"]).toBe(30n);
  });

  it("rejects creation without oracle", () => {
    mock.setRewardDistributor("ST2REWARD");
    mock.setStakingPool("ST2POOL");

    const result = mock.createMaintenanceContract(
      101n, "Test", "desc", 1000n, 100n,
      ["A"], ["B"], [100n]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ORACLE_NOT_SET);
  });

  it("rejects invalid milestone payout sum", () => {
    mock.setOracle("ST2ORACLE");
    mock.setRewardDistributor("ST2REWARD");
    mock.setStakingPool("ST2POOL");

    const result = mock.createMaintenanceContract(
      101n, "Test", "desc", 1000n, 100n,
      ["A", "B"], ["B", "C"], [50n, 60n]
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_MILESTONES);
  });

  it("updates contract status", () => {
    mock.setOracle("ST2ORACLE");
    mock.setRewardDistributor("ST2REWARD");
    mock.setStakingPool("ST2POOL");
    mock.createMaintenanceContract(
      101n, "Test", "desc", 1000n, 100n,
      ["A"], ["B"], [100n]
    );

    const result = mock.updateContractStatus(0n, "active");
    expect(result.ok).toBe(true);
    expect(mock.getContract(0n)?.status).toBe("active");
  });

  it("verifies milestone", () => {
    mock.setOracle("ST2ORACLE");
    mock.setRewardDistributor("ST2REWARD");
    mock.setStakingPool("ST2POOL");
    mock.createMaintenanceContract(
      101n, "Test", "desc", 1000n, 100n,
      ["Inspect"], ["Check"], [100n]
    );
    mock.updateContractStatus(0n, "active");

    const result = mock.verifyMilestone(0n, 0n);
    expect(result.ok).toBe(true);
    const milestones = mock.getMilestones(0n);
    expect(milestones?.[0].verified).toBe(true);
  });

  it("closes contract after timeline", () => {
    mock.setOracle("ST2ORACLE");
    mock.setRewardDistributor("ST2REWARD");
    mock.setStakingPool("ST2POOL");
    mock.createMaintenanceContract(
      101n, "Test", "desc", 1000n, 10n,
      ["A"], ["B"], [100n]
    );
    mock.blockHeight += 120n;

    const result = mock.closeContract(0n);
    expect(result.ok).toBe(true);
    expect(mock.getContract(0n)?.status).toBe("closed");
  });

  it("rejects close before end", () => {
    mock.setOracle("ST2ORACLE");
    mock.setRewardDistributor("ST2REWARD");
    mock.setStakingPool("ST2POOL");
    mock.createMaintenanceContract(
      101n, "Test", "desc", 1000n, 100n,
      ["A"], ["B"], [100n]
    );

    const result = mock.closeContract(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TIMELINE);
  });
});