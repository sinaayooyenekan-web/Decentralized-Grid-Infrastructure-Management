;; RewardDistributor.clar
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-CONTRACT-NOT-FOUND u101)
(define-constant ERR-INVALID-AMOUNT u102)
(define-constant ERR-MILESTONE-NOT-VERIFIED u103)
(define-constant ERR-ALREADY-DISTRIBUTED u104)
(define-constant ERR-CONTRACT-CLOSED u105)
(define-constant ERR-INSUFFICIENT-FUNDS u106)
(define-constant ERR-INVALID-PAYOUT u107)
(define-constant ERR-STAKING-NOT-SET u108)
(define-constant ERR-ORACLE-NOT-SET u109)

(define-data-var factory-contract principal tx-sender)
(define-data-var staking-pool-contract (optional principal) none)
(define-data-var grid-token-contract principal tx-sender)

(define-map milestone-payouts
  { contract-id: uint, milestone-id: uint }
  { distributed: bool, amount: uint, payout-block: uint }
)

(define-map contract-rewards
  uint
  { total-claimed: uint, last-distributed-milestone: uint }
)

(define-read-only (get-factory)
  (var-get factory-contract)
)

(define-read-only (get-staking-pool)
  (var-get staking-pool-contract)
)

(define-read-only (get-grid-token)
  (var-get grid-token-contract)
)

(define-read-only (get-milestone-payout (contract-id uint) (milestone-id uint))
  (map-get? milestone-payouts { contract-id: contract-id, milestone-id: milestone-id })
)

(define-read-only (get-contract-rewards (contract-id uint))
  (default-to { total-claimed: u0, last-distributed-milestone: u0 }
    (map-get? contract-rewards contract-id))
)

(define-private (is-factory)
  (is-eq tx-sender (var-get factory-contract))
)

(define-private (is-staking-set)
  (is-some (var-get staking-pool-contract))
)

(define-public (set-factory (new-factory principal))
  (begin
    (asserts! (is-eq tx-sender contract-owner) (err ERR-UNAUTHORIZED))
    (var-set factory-contract new-factory)
    (ok true)
  )
)

(define-public (set-staking-pool (pool principal))
  (begin
    (asserts! (is-factory) (err ERR-UNAUTHORIZED))
    (var-set staking-pool-contract (some pool))
    (ok true)
  )
)

(define-public (set-grid-token (token principal))
  (begin
    (asserts! (is-factory) (err ERR-UNAUTHORIZED))
    (var-set grid-token-contract token)
    (ok true)
  )
)

(define-public (distribute-milestone-reward (contract-id uint) (milestone-id uint))
  (let (
    (contract (unwrap! (contract-call? (var-get factory-contract) get-contract contract-id) (err ERR-CONTRACT-NOT-FOUND)))
    (milestones (unwrap! (contract-call? (var-get factory-contract) get-milestones contract-id) (err ERR-CONTRACT-NOT-FOUND)))
    (milestone (unwrap! (element-at milestones milestone-id) (err ERR-MILESTONE-NOT-VERIFIED)))
    (payout-info (get-milestone-payout contract-id milestone-id))
    (contract-rewards-info (get-contract-rewards contract-id))
    (budget (get budget contract))
    (payout-percent (get payout-percent milestone))
    (payout-amount (/ (* budget payout-percent) u100))
  )
    (asserts! (is-staking-set) (err ERR-STAKING-NOT-SET))
    (asserts! (get verified milestone) (err ERR-MILESTONE-NOT-VERIFIED))
    (asserts! (is-none payout-info) (err ERR-ALREADY-DISTRIBUTED))
    (asserts! (is-eq (get status contract) "active") (err ERR-CONTRACT-CLOSED))

    (let ((total-staked (get total-staked (unwrap! (contract-call? (unwrap! (var-get staking-pool-contract) (err ERR-STAKING-NOT-SET)) get-contract-staking contract-id) (err ERR-CONTRACT-NOT-FOUND)))))
      (asserts! (> total-staked u0) (err ERR-INSUFFICIENT-FUNDS))

      (map-set milestone-payouts
        { contract-id: contract-id, milestone-id: milestone-id }
        { distributed: true, amount: payout-amount, payout-block: block-height }
      )

      (map-set contract-rewards contract-id
        (merge contract-rewards-info {
          total-claimed: (+ (get total-claimed contract-rewards-info) payout-amount),
          last-distributed-milestone: milestone-id
        })
      )

      (try! (as-contract (contract-call? (var-get grid-token-contract) transfer payout-amount tx-sender (as-contract tx-sender))))
      (try! (contract-call? (unwrap! (var-get staking-pool-contract) (err ERR-STAKING-NOT-SET)) notify-milestone-verified contract-id milestone-id))

      (print { event: "milestone-reward-distributed", contract: contract-id, milestone: milestone-id, amount: payout-amount })
      (ok payout-amount)
    )
  )
)

(define-public (emergency-withdraw (amount uint))
  (begin
    (asserts! (is-factory) (err ERR-UNAUTHORIZED))
    (try! (as-contract (contract-call? (var-get grid-token-contract) transfer amount tx-sender (var-get factory-contract))))
    (ok true)
  )
)