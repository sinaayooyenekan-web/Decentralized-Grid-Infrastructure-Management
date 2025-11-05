;; StakingPool.clar
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-CONTRACT-NOT-FOUND u101)
(define-constant ERR-INVALID-AMOUNT u102)
(define-constant ERR-INSUFFICIENT-BALANCE u103)
(define-constant ERR-CONTRACT-CLOSED u104)
(define-constant ERR-ALREADY-STAKED u105)
(define-constant ERR-NOT-STAKED u106)
(define-constant ERR-REWARD-CLAIMED u107)
(define-constant ERR-INVALID-REWARD-RATE u108)
(define-constant ERR-MILESTONE-NOT-VERIFIED u109)
(define-constant ERR-STAKING-CLOSED u110)

(define-constant GRID-TOKEN-PRINCIPAL (as-contract tx-sender))
(define-constant REWARD-DECIMALS u6)
(define-constant MAX-REWARD-RATE u10000)

(define-data-var factory-contract principal tx-sender)
(define-data-var reward-rate uint u200)
(define-data-var total-staked uint u0)
(define-data-var total-rewards-distributed uint u0)

(define-map stakes
  { contract-id: uint, staker: principal }
  { amount: uint, reward-debt: uint, last-claim-block: uint }
)

(define-map contract-staking
  uint
  { total-staked: uint, accrued-reward-per-share: uint, last-reward-block: uint }
)

(define-map pending-rewards
  { contract-id: uint, staker: principal }
  uint
)

(define-read-only (get-factory)
  (var-get factory-contract)
)

(define-read-only (get-reward-rate)
  (var-get reward-rate)
)

(define-read-only (get-total-staked)
  (var-get total-staked)
)

(define-read-only (get-contract-staking (contract-id uint))
  (map-get? contract-staking contract-id)
)

(define-read-only (get-staker-info (contract-id uint) (staker principal))
  (map-get? stakes { contract-id: contract-id, staker: staker })
)

(define-read-only (get-pending-reward (contract-id uint) (staker principal))
  (default-to u0 (map-get? pending-rewards { contract-id: contract-id, staker: staker }))
)

(define-private (is-factory)
  (is-eq tx-sender (var-get factory-contract))
)

(define-private (update-reward (contract-id uint))
  (let ((contract-data (unwrap! (map-get? contract-staking contract-id) (ok u0)))
        (current-block block-height)
        (last-block (get last-reward-block contract-data)))
    (if (and (> current-block last-block) (> (get total-staked contract-data) u0))
      (let ((blocks-passed (- current-block last-block))
            (reward-per-block (/ (* (var-get reward-rate) (get total-staked contract-data)) MAX-REWARD-RATE))
            (total-reward (* blocks-passed reward-per-block))
            (accrued (+ (get accrued-reward-per-share contract-data) (/ (* total-reward REWARD-DECIMALS) (get total-staked contract-data)))))
        (map-set contract-staking contract-id
          (merge contract-data {
            accrued-reward-per-share: accrued,
            last-reward-block: current-block
          })
        )
        (ok accrued)
      )
      (ok (get accrued-reward-per-share contract-data))
    )
  )
)

(define-public (set-factory (new-factory principal))
  (begin
    (asserts! (is-eq tx-sender contract-owner) (err ERR-UNAUTHORIZED))
    (var-set factory-contract new-factory)
    (ok true)
  )
)

(define-public (set-reward-rate (new-rate uint))
  (begin
    (asserts! (is-factory) (err ERR-UNAUTHORIZED))
    (asserts! (<= new-rate MAX-REWARD-RATE) (err ERR-INVALID-REWARD-RATE))
    (var-set reward-rate new-rate)
    (ok true)
  )
)

(define-public (initialize-contract (contract-id uint))
  (begin
    (asserts! (is-factory) (err ERR-UNAUTHORIZED))
    (asserts! (is-none (map-get? contract-staking contract-id)) (err ERR-ALREADY-STAKED))
    (map-set contract-staking contract-id
      { total-staked: u0, accrued-reward-per-share: u0, last-reward-block: block-height }
    )
    (ok true)
  )
)

(define-public (stake (contract-id uint) (amount uint))
  (let ((staker tx-sender)
        (existing (map-get? stakes { contract-id: contract-id, staker: staker }))
        (contract-data (unwrap! (map-get? contract-staking contract-id) (err ERR-CONTRACT-NOT-FOUND))))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (is-eq (get status (unwrap! (contract-call? (var-get factory-contract) get-contract contract-id) (err ERR-CONTRACT-NOT-FOUND))) "open") (err ERR-STAKING-CLOSED))
    (try! (update-reward contract-id))
    (match existing
      stake-info
        (let ((new-amount (+ (get amount stake-info) amount))
              (pending (get-pending-reward contract-id staker)))
          (if (> pending u0)
            (begin
              (map-delete pending-rewards { contract-id: contract-id, staker: staker })
              (try! (as-contract (contract-call? .grid-token transfer pending staker GRID-TOKEN-PRINCIPAL)))
              (var-set total-rewards-distributed (+ (var-get total-rewards-distributed) pending))
            )
            (ok u0)
          )
          (map-set stakes { contract-id: contract-id, staker: staker }
            (merge stake-info {
              amount: new-amount,
              reward-debt: (/ (* new-amount (get accrued-reward-per-share contract-data)) REWARD-DECIMALS),
              last-claim-block: block-height
            })
          )
          (map-set contract-staking contract-id
            (merge contract-data { total-staked: (+ (get total-staked contract-data) amount) }))
          (var-set total-staked (+ (var-get total-staked) amount))
          (try! (contract-call? .grid-token transfer amount staker (as-contract tx-sender)))
          (ok true)
        )
      (begin
        (map-set stakes { contract-id: contract-id, staker: staker }
          {
            amount: amount,
            reward-debt: (/ (* amount (get accrued-reward-per-share contract-data)) REWARD-DECIMALS),
            last-claim-block: block-height
          }
        )
        (map-set contract-staking contract-id
          (merge contract-data { total-staked: (+ (get total-staked contract-data) amount) }))
        (var-set total-staked (+ (var-get total-staked) amount))
        (try! (contract-call? .grid-token transfer amount staker (as-contract tx-sender)))
        (ok true)
      )
    )
  )
)

(define-public (unstake (contract-id uint) (amount uint))
  (let ((staker tx-sender)
        (stake-info (unwrap! (map-get? stakes { contract-id: contract-id, staker: staker }) (err ERR-NOT-STAKED)))
        (contract-data (unwrap! (map-get? contract-staking contract-id) (err ERR-CONTRACT-NOT-FOUND))))
    (asserts! (>= (get amount stake-info) amount) (err ERR-INSUFFICIENT-BALANCE))
    (try! (update-reward contract-id))
    (let ((pending (+ (get-pending-reward contract-id staker)
                      (- (/ (* (get amount stake-info) (get accrued-reward-per-share contract-data)) REWARD-DECIMALS) (get reward-debt stake-info)))))
      (if (> pending u0)
        (begin
          (map-set pending-rewards { contract-id: contract-id, staker: staker } pending)
          (var-set total-rewards-distributed (+ (var-get total-rewards-distributed) pending))
        )
        (ok u0)
      )
      (let ((new-amount (- (get amount stake-info) amount)))
        (if (is-eq new-amount u0)
          (map-delete stakes { contract-id: contract-id, staker: staker })
          (map-set stakes { contract-id: contract-id, staker: staker }
            (merge stake-info {
              amount: new-amount,
              reward-debt: (/ (* new-amount (get accrued-reward-per-share contract-data)) REWARD-DECIMALS)
            }))
        )
        (map-set contract-staking contract-id
          (merge contract-data { total-staked: (- (get total-staked contract-data) amount) }))
        (var-set total-staked (- (var-get total-staked) amount))
        (try! (as-contract (contract-call? .grid-token transfer amount GRID-TOKEN-PRINCIPAL staker)))
        (ok true)
      )
    )
  )
)

(define-public (claim-reward (contract-id uint))
  (let ((staker tx-sender)
        (stake-info (unwrap! (map-get? stakes { contract-id: contract-id, staker: staker }) (err ERR-NOT-STAKED)))
        (contract-data (unwrap! (map-get? contract-staking contract-id) (err ERR-CONTRACT-NOT-FOUND))))
    (try! (update-reward contract-id))
    (let ((pending (+ (get-pending-reward contract-id staker)
                      (- (/ (* (get amount stake-info) (get accrued-reward-per-share contract-data)) REWARD-DECIMALS) (get reward-debt stake-info)))))
      (asserts! (> pending u0) (err ERR-REWARD-CLAIMED))
      (map-delete pending-rewards { contract-id: contract-id, staker: staker })
      (map-set stakes { contract-id: contract-id, staker: staker }
        (merge stake-info {
          reward-debt: (/ (* (get amount stake-info) (get accrued-reward-per-share contract-data)) REWARD-DECIMALS),
          last-claim-block: block-height
        })
      )
      (var-set total-rewards-distributed (+ (var-get total-rewards-distributed) pending))
      (try! (as-contract (contract-call? .grid-token transfer pending GRID-TOKEN-PRINCIPAL staker)))
      (ok pending)
    )
  )
)

(define-public (notify-milestone-verified (contract-id uint) (milestone-id uint))
  (begin
    (asserts! (is-factory) (err ERR-UNAUTHORIZED))
    (try! (update-reward contract-id))
    (ok true)
  )
)