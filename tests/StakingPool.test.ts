// StakingPool.test.ts
import { describe, it, expect, beforeEach } from "vitest";

const ERR_UNAUTHORIZED = 100;
const ERR_CONTRACT_NOT_FOUND = 101;
const ERR_INVALID_AMOUNT = 102;
const ERR_INSUFFICIENT_BALANCE = 103;
const ERR_CONTRACT_CLOSED = 104;
const ERR_ALREADY_STAKED = 105;
const ERR_NOT_STAKED = 106;
const ERR_REWARD_CLAIMED = 107;
const ERR_INVALID_REWARD_RATE = 108;
const ERR_MILESTONE_NOT_VERIFIED = 109;
const ERR_STAKING_CLOSED = 110;

interface StakeInfo {
  amount: bigint;
  rewardDebt: bigint;
  lastClaimBlock: bigint;
}

interface ContractStaking {
  totalStaked: bigint;
  accruedRewardPerShare: bigint;
  lastRewardBlock: bigint;
}

interface StakingPoolState {
  factoryContract: string;
  rewardRate: bigint;
  totalStaked: bigint;
  totalRewardsDistributed: bigint;
  stakes: Map<string, StakeInfo>;
  contractStaking: Map<bigint, ContractStaking>;
  pendingRewards: Map<string, bigint>;
  gridTokenTransfers: Array<{ amount: bigint; from: string; to: string }>;
  blockHeight: bigint;
}

class StakingPoolMock {
  state: StakingPoolState;
  caller: string;
  owner: string;
  factory: string;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      factoryContract: "ST1FACTORY",
      rewardRate: 200n,
      totalStaked: 0n,
      totalRewardsDistributed: 0n,
      stakes: new Map(),
      contractStaking: new Map(),
      pendingRewards: new Map(),
      gridTokenTransfers: [],
      blockHeight: 100n,
    };
    this.caller = "ST1CALLER";
    this.owner = "ST1OWNER";
    this.factory = "ST1FACTORY";
  }

  private isFactory() {
    return this.caller === this.factory;
  }

  private updateReward(contractId: bigint): bigint {
    const key = contractId.toString();
    const contractData = this.state.contractStaking.get(key) || {
      totalStaked: 0n,
      accruedRewardPerShare: 0n,
      lastRewardBlock: this.state.blockHeight,
    };
    if (
      this.state.blockHeight <= contractData.lastRewardBlock ||
      contractData.totalStaked === 0n
    ) {
      return contractData.accruedRewardPerShare;
    }
    const blocksPassed = this.state.blockHeight - contractData.lastRewardBlock;
    const rewardPerBlock =
      (this.state.rewardRate * contractData.totalStaked) / 10000n;
    const totalReward = blocksPassed * rewardPerBlock;
    const accrued =
      contractData.accruedRewardPerShare +
      (totalReward * 1000000n) / contractData.totalStaked;
    this.state.contractStaking.set(key, {
      ...contractData,
      accruedRewardPerShare: accrued,
      lastRewardBlock: this.state.blockHeight,
    });
    return accrued;
  }

  setFactory(newFactory: string): { ok: boolean; value: boolean } {
    if (this.caller !== this.owner) return { ok: false, value: false };
    this.state.factoryContract = newFactory;
    this.factory = newFactory;
    return { ok: true, value: true };
  }

  setRewardRate(newRate: bigint): { ok: boolean; value: boolean | number } {
    if (!this.isFactory()) return { ok: false, value: false };
    if (newRate > 10000n) return { ok: false, value: ERR_INVALID_REWARD_RATE };
    this.state.rewardRate = newRate;
    return { ok: true, value: true };
  }

  initializeContract(contractId: bigint): {
    ok: boolean;
    value: boolean | number;
  } {
    if (!this.isFactory()) return { ok: false, value: false };
    const key = contractId.toString();
    if (this.state.contractStaking.has(key))
      return { ok: false, value: ERR_ALREADY_STAKED };
    this.state.contractStaking.set(key, {
      totalStaked: 0n,
      accruedRewardPerShare: 0n,
      lastRewardBlock: this.state.blockHeight,
    });
    return { ok: true, value: true };
  }

  stake(
    contractId: bigint,
    amount: bigint
  ): { ok: boolean; value: boolean | number } {
    if (amount <= 0n) return { ok: false, value: ERR_INVALID_AMOUNT };
    const stakeKey = `${contractId}-${this.caller}`;
    const contractKey = contractId.toString();
    const contractData = this.state.contractStaking.get(contractKey);
    if (!contractData) return { ok: false, value: ERR_CONTRACT_NOT_FOUND };

    this.updateReward(contractId);
    const pending = this.state.pendingRewards.get(stakeKey) || 0n;
    if (pending > 0n) {
      this.state.gridTokenTransfers.push({
        amount: pending,
        from: "CONTRACT",
        to: this.caller,
      });
      this.state.totalRewardsDistributed += pending;
      this.state.pendingRewards.delete(stakeKey);
    }

    const existing = this.state.stakes.get(stakeKey);
    if (existing) {
      const newAmount = existing.amount + amount;
      const rewardDebt =
        (newAmount * contractData.accruedRewardPerShare) / 1000000n;
      this.state.stakes.set(stakeKey, {
        ...existing,
        amount: newAmount,
        rewardDebt,
        lastClaimBlock: this.state.blockHeight,
      });
      this.state.contractStaking.set(contractKey, {
        ...contractData,
        totalStaked: contractData.totalStaked + amount,
      });
      this.state.totalStaked += amount;
    } else {
      const rewardDebt =
        (amount * contractData.accruedRewardPerShare) / 1000000n;
      this.state.stakes.set(stakeKey, {
        amount,
        rewardDebt,
        lastClaimBlock: this.state.blockHeight,
      });
      this.state.contractStaking.set(contractKey, {
        ...contractData,
        totalStaked: contractData.totalStaked + amount,
      });
      this.state.totalStaked += amount;
    }
    this.state.gridTokenTransfers.push({
      amount,
      from: this.caller,
      to: "CONTRACT",
    });
    return { ok: true, value: true };
  }

  unstake(
    contractId: bigint,
    amount: bigint
  ): { ok: boolean; value: boolean | number } {
    const stakeKey = `${contractId}-${this.caller}`;
    const stakeInfo = this.state.stakes.get(stakeKey);
    if (!stakeInfo || stakeInfo.amount < amount)
      return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    const contractKey = contractId.toString();
    const contractData = this.state.contractStaking.get(contractKey)!;

    this.updateReward(contractId);
    const pending =
      (stakeInfo.amount * contractData.accruedRewardPerShare) / 1000000n -
      stakeInfo.rewardDebt;
    if (pending > 0n) {
      this.state.pendingRewards.set(stakeKey, pending);
      this.state.totalRewardsDistributed += pending;
    }

    const newAmount = stakeInfo.amount - amount;
    if (newAmount === 0n) {
      this.state.stakes.delete(stakeKey);
    } else {
      const newDebt =
        (newAmount * contractData.accruedRewardPerShare) / 1000000n;
      this.state.stakes.set(stakeKey, {
        ...stakeInfo,
        amount: newAmount,
        rewardDebt: newDebt,
      });
    }
    this.state.contractStaking.set(contractKey, {
      ...contractData,
      totalStaked: contractData.totalStaked - amount,
    });
    this.state.totalStaked -= amount;
    this.state.gridTokenTransfers.push({
      amount,
      from: "CONTRACT",
      to: this.caller,
    });
    return { ok: true, value: true };
  }

  claimReward(contractId: bigint): { ok: boolean; value: bigint | number } {
    const stakeKey = `${contractId}-${this.caller}`;
    const stakeInfo = this.state.stakes.get(stakeKey);
    if (!stakeInfo) return { ok: false, value: ERR_NOT_STAKED };
    const contractKey = contractId.toString();
    const contractData = this.state.contractStaking.get(contractKey)!;

    this.updateReward(contractId);
    const pending =
      (stakeInfo.amount * contractData.accruedRewardPerShare) / 1000000n -
      stakeInfo.rewardDebt;
    if (pending <= 0n) return { ok: false, value: ERR_REWARD_CLAIMED };

    this.state.pendingRewards.delete(stakeKey);
    const newDebt =
      (stakeInfo.amount * contractData.accruedRewardPerShare) / 1000000n;
    this.state.stakes.set(stakeKey, {
      ...stakeInfo,
      rewardDebt: newDebt,
      lastClaimBlock: this.state.blockHeight,
    });
    this.state.totalRewardsDistributed += pending;
    this.state.gridTokenTransfers.push({
      amount: pending,
      from: "CONTRACT",
      to: this.caller,
    });
    return { ok: true, value: pending };
  }
}

describe("StakingPool", () => {
  let mock: StakingPoolMock;

  beforeEach(() => {
    mock = new StakingPoolMock();
    mock.reset();
    mock.caller = mock.factory;
  });

  it("initializes and stakes successfully", () => {
    mock.caller = mock.factory;
    mock.initializeContract(1n);
    mock.caller = "ST1STAKER";
    const result = mock.stake(1n, 1000n);
    expect(result.ok).toBe(true);
    expect(mock.state.totalStaked).toBe(1000n);
    expect(mock.state.gridTokenTransfers).toContainEqual({
      amount: 1000n,
      from: "ST1STAKER",
      to: "CONTRACT",
    });
  });

  it("unstakes with pending rewards", () => {
    mock.caller = mock.factory;
    mock.initializeContract(1n);
    mock.caller = "ST1STAKER";
    mock.stake(1n, 1000n);
    mock.state.blockHeight += 5n;
    const unstake = mock.unstake(1n, 500n);
    expect(unstake.ok).toBe(true);
    expect(mock.state.totalStaked).toBe(500n);
  });

  it("rejects stake on uninitialized contract", () => {
    mock.caller = "ST1STAKER";
    const result = mock.stake(999n, 1000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_CONTRACT_NOT_FOUND);
  });

  it("rejects invalid reward rate", () => {
    mock.caller = mock.factory;
    const result = mock.setRewardRate(10001n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_REWARD_RATE);
  });
});
