// RewardDistributor.test.ts
import { describe, it, expect, beforeEach } from "vitest";

const ERR_UNAUTHORIZED = 100;
const ERR_CONTRACT_NOT_FOUND = 101;
const ERR_INVALID_AMOUNT = 102;
const ERR_MILESTONE_NOT_VERIFIED = 103;
const ERR_ALREADY_DISTRIBUTED = 104;
const ERR_CONTRACT_CLOSED = 105;
const ERR_INSUFFICIENT_FUNDS = 106;
const ERR_INVALID_PAYOUT = 107;
const ERR_STAKING_NOT_SET = 108;
const ERR_ORACLE_NOT_SET = 109;

interface Milestone {
  id: bigint;
  name: string;
  description: string;
  "payout-percent": bigint;
  verified: boolean;
  "verified-at": any;
}

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

interface PayoutInfo {
  distributed: boolean;
  amount: bigint;
  "payout-block": bigint;
}

interface ContractRewards {
  "total-claimed": bigint;
  "last-distributed-milestone": bigint;
}

class RewardDistributorMock {
  state: {
    factoryContract: string;
    stakingPoolContract: string | null;
    gridTokenContract: string;
    milestonePayouts: Map<string, PayoutInfo>;
    contractRewards: Map<bigint, ContractRewards>;
    prints: Array<{ [key: string]: any }>;
    gridTransfers: Array<{ amount: bigint; from: string; to: string }>;
  };
  caller: string;
  factory: string;
  blockHeight: bigint;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      factoryContract: "ST1FACTORY",
      stakingPoolContract: null,
      gridTokenContract: "ST1GRID",
      milestonePayouts: new Map(),
      contractRewards: new Map(),
      prints: [],
      gridTransfers: [],
    };
    this.caller = "ST1CALLER";
    this.factory = "ST1FACTORY";
    this.blockHeight = 200n;
  }

  private isFactory() {
    return this.caller === this.factory;
  }

  setFactory(newFactory: string): { ok: boolean; value: boolean } {
    if (this.caller !== "ST1OWNER") return { ok: false, value: false };
    this.state.factoryContract = newFactory;
    this.factory = newFactory;
    return { ok: true, value: true };
  }

  setStakingPool(pool: string): { ok: boolean; value: boolean } {
    if (!this.isFactory()) return { ok: false, value: false };
    this.state.stakingPoolContract = pool;
    return { ok: true, value: true };
  }

  setGridToken(token: string): { ok: boolean; value: boolean } {
    if (!this.isFactory()) return { ok: false, value: false };
    this.state.gridTokenContract = token;
    return { ok: true, value: true };
  }

  getContract(contractId: bigint): Contract | null {
    return contractId === 1n
      ? {
          "asset-id": 101n,
          title: "Fix Line",
          description: "Repair 5km",
          budget: 10000n,
          "start-block": 100n,
          "end-block": 300n,
          creator: "ST1CREATOR",
          status: "active",
          "total-staked": 5000n,
          "total-rewards": 0n,
        }
      : null;
  }

  getMilestones(contractId: bigint): Milestone[] | null {
    return contractId === 1n
      ? [
          {
            id: 0n,
            name: "Inspect",
            description: "Check",
            "payout-percent": 40n,
            verified: true,
            "verified-at": {},
          },
          {
            id: 1n,
            name: "Repair",
            description: "Fix",
            "payout-percent": 60n,
            verified: false,
            "verified-at": null,
          },
        ]
      : null;
  }

  getContractStaking(contractId: bigint): { totalStaked: bigint } | null {
    return contractId === 1n ? { totalStaked: 5000n } : null;
  }

  notifyMilestoneVerified(
    contractId: bigint,
    milestoneId: bigint
  ): { ok: boolean; value: boolean } {
    return { ok: true, value: true };
  }

  distributeMilestoneReward(
    contractId: bigint,
    milestoneId: bigint
  ): { ok: boolean; value: bigint | number } {
    if (!this.state.stakingPoolContract)
      return { ok: false, value: ERR_STAKING_NOT_SET };
    const contract = this.getContract(contractId);
    if (!contract) return { ok: false, value: ERR_CONTRACT_NOT_FOUND };
    const milestones = this.getMilestones(contractId);
    if (!milestones) return { ok: false, value: ERR_CONTRACT_NOT_FOUND };
    const milestone = milestones[Number(milestoneId)];
    if (!milestone) return { ok: false, value: ERR_MILESTONE_NOT_VERIFIED };
    if (!milestone.verified)
      return { ok: false, value: ERR_MILESTONE_NOT_VERIFIED };

    const payoutKey = `${contractId}-${milestoneId}`;
    if (this.state.milestonePayouts.has(payoutKey))
      return { ok: false, value: ERR_ALREADY_DISTRIBUTED };
    if (contract.status !== "active")
      return { ok: false, value: ERR_CONTRACT_CLOSED };

    const staking = this.getContractStaking(contractId);
    if (!staking || staking.totalStaked === 0n)
      return { ok: false, value: ERR_INSUFFICIENT_FUNDS };

    const payoutAmount = (contract.budget * milestone["payout-percent"]) / 100n;
    this.state.milestonePayouts.set(payoutKey, {
      distributed: true,
      amount: payoutAmount,
      "payout-block": this.blockHeight,
    });

    const rewards = this.state.contractRewards.get(contractId) || {
      "total-claimed": 0n,
      "last-distributed-milestone": 0n,
    };
    this.state.contractRewards.set(contractId, {
      "total-claimed": rewards["total-claimed"] + payoutAmount,
      "last-distributed-milestone": milestoneId,
    });

    this.state.gridTransfers.push({
      amount: payoutAmount,
      from: "CONTRACT",
      to: "CONTRACT",
    });
    this.state.prints.push({
      event: "milestone-reward-distributed",
      contract: contractId,
      milestone: milestoneId,
      amount: payoutAmount,
    });

    return { ok: true, value: payoutAmount };
  }

  emergencyWithdraw(amount: bigint): { ok: boolean; value: boolean } {
    if (!this.isFactory()) return { ok: false, value: false };
    this.state.gridTransfers.push({
      amount,
      from: "CONTRACT",
      to: this.factory,
    });
    return { ok: true, value: true };
  }
}

describe("RewardDistributor", () => {
  let mock: RewardDistributorMock;

  beforeEach(() => {
    mock = new RewardDistributorMock();
    mock.reset();
    mock.caller = mock.factory;
    mock.setStakingPool("ST1POOL");
  });

  it("distributes milestone reward successfully", () => {
    const result = mock.distributeMilestoneReward(1n, 0n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(4000n);
    expect(mock.state.milestonePayouts.get("1-0")?.distributed).toBe(true);
    expect(mock.state.prints[0]?.amount).toBe(4000n);
  });

  it("rejects unverified milestone", () => {
    const result = mock.distributeMilestoneReward(1n, 1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MILESTONE_NOT_VERIFIED);
  });

  it("rejects already distributed milestone", () => {
    mock.distributeMilestoneReward(1n, 0n);
    const result = mock.distributeMilestoneReward(1n, 0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_DISTRIBUTED);
  });

  it("rejects distribution without staking pool", () => {
    mock.state.stakingPoolContract = null;
    const result = mock.distributeMilestoneReward(1n, 0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_STAKING_NOT_SET);
  });

  it("tracks total claimed rewards", () => {
    mock.distributeMilestoneReward(1n, 0n);
    const rewards = mock.state.contractRewards.get(1n);
    expect(rewards?.["total-claimed"]).toBe(4000n);
    expect(rewards?.["last-distributed-milestone"]).toBe(0n);
  });

  it("allows emergency withdrawal by factory", () => {
    const result = mock.emergencyWithdraw(1000n);
    expect(result.ok).toBe(true);
    expect(mock.state.gridTransfers).toContainEqual({
      amount: 1000n,
      from: "CONTRACT",
      to: mock.factory,
    });
  });
});
