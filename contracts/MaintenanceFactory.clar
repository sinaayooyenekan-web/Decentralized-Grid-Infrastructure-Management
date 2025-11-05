(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-ASSET-NOT-FOUND u101)
(define-constant ERR-INVALID-BUDGET u102)
(define-constant ERR-INVALID-TIMELINE u103)
(define-constant ERR-INVALID-MILESTONES u104)
(define-constant ERR-CONTRACT-EXISTS u105)
(define-constant ERR-INVALID-STATUS u106)
(define-constant ERR-MILESTONE-NOT-FOUND u107)
(define-constant ERR-STAKING-NOT-INITIALIZED u108)
(define-constant ERR-INVALID-NFT-ID u109)
(define-constant ERR-ORACLE-NOT-SET u110)
(define-constant ERR-REWARD-NOT-SET u111)
(define-constant ERR-INVALID-OWNER u112)
(define-constant ERR-CONTRACT-CLOSED u113)

(define-data-var next-contract-id uint u0)
(define-data-var oracle-contract (optional principal) none)
(define-data-var reward-distributor (optional principal) none)
(define-data-var staking-pool-contract (optional principal) none)

(define-non-fungible-token maintenance-contract uint)

(define-map contracts
  uint
  {
    asset-id: uint,
    title: (string-ascii 120),
    description: (string-utf8 1000),
    budget: uint,
    start-block: uint,
    end-block: uint,
    creator: principal,
    status: (string-ascii 20),
    total-staked: uint,
    total-rewards: uint
  }
)

(define-map contract-milestones
  uint
  (list 10 {
    id: uint,
    name: (string-ascii 80),
    description: (string-utf8 500),
    payout-percent: uint,
    verified: bool,
    verified-at: (optional uint)
  })
)

(define-map milestone-counter uint uint)

(define-read-only (get-contract (id uint))
  (map-get? contracts id)
)

(define-read-only (get-milestones (contract-id uint))
  (map-get? contract-milestones contract-id)
)

(define-read-only (get-milestone-count (contract-id uint))
  (default-to u0 (map-get? milestone-counter contract-id))
)

(define-read-only (get-next-contract-id)
  (var-get next-contract-id)
)

(define-read-only (get-oracle)
  (var-get oracle-contract)
)

(define-read-only (get-reward-distributor)
  (var-get reward-distributor)
)

(define-read-only (get-staking-pool)
  (var-get staking-pool-contract)
)

(define-private (validate-budget (budget uint))
  (if (> budget u0) (ok true) (err ERR-INVALID-BUDGET))
)

(define-private (validate-timeline (start uint) (end uint))
  (if (and (>= start block-height) (> end start)) (ok true) (err ERR-INVALID-TIMELINE))
)

(define-private (validate-milestone-payouts (milestones (list 10 uint)))
  (let ((total (fold + milestones u0)))
    (if (is-eq total u100) (ok true) (err ERR-INVALID-MILESTONES))
  )
)

(define-private (is-oracle-set)
  (is-some (var-get oracle-contract))
)

(define-private (is-reward-set)
  (is-some (var-get reward-distributor))
)

(define-private (is-staking-set)
  (is-some (var-get staking-pool-contract))
)

(define-public (set-oracle (new-oracle principal))
  (begin
    (asserts! (is-eq tx-sender contract-owner) (err ERR-UNAUTHORIZED))
    (var-set oracle-contract (some new-oracle))
    (ok true)
  )
)

(define-public (set-reward-distributor (distributor principal))
  (begin
    (asserts! (is-eq tx-sender contract-owner) (err ERR-UNAUTHORIZED))
    (var-set reward-distributor (some distributor))
    (ok true)
  )
)

(define-public (set-staking-pool (pool principal))
  (begin
    (asserts! (is-eq tx-sender contract-owner) (err ERR-UNAUTHORIZED))
    (var-set staking-pool-contract (some pool))
    (ok true)
  )
)

(define-public (create-maintenance-contract
  (asset-id uint)
  (title (string-ascii 120))
  (description (string-utf8 1000))
  (budget uint)
  (duration-blocks uint)
  (milestone-names (list 10 (string-ascii 80)))
  (milestone-descs (list 10 (string-utf8 500)))
  (milestone-payouts (list 10 uint))
)
  (let (
    (contract-id (var-get next-contract-id))
    (start-block (+ block-height u1))
    (end-block (+ start-block duration-blocks))
    (milestone-count (len milestone-names))
  )
    (try! (validate-budget budget))
    (try! (validate-timeline start-block end-block))
    (asserts! (> milestone-count u0) (err ERR-INVALID-MILESTONES))
    (asserts! (<= milestone-count u10) (err ERR-INVALID-MILESTONES))
    (try! (validate-milestone-payouts milestone-payouts))
    (asserts! (is-oracle-set) (err ERR-ORACLE-NOT-SET))
    (asserts! (is-reward-set) (err ERR-REWARD-NOT-SET))
    (asserts! (is-staking-set) (err ERR-STAKING-NOT-INITIALIZED))

    (map-set contracts contract-id
      {
        asset-id: asset-id,
        title: title,
        description: description,
        budget: budget,
        start-block: start-block,
        end-block: end-block,
        creator: tx-sender,
        status: "open",
        total-staked: u0,
        total-rewards: u0
      }
    )

    (let ((milestones
            (map (lambda (i)
                   {
                     id: i,
                     name: (unwrap-panic (element-at milestone-names i)),
                     description: (unwrap-panic (element-at milestone-descs i)),
                     payout-percent: (unwrap-panic (element-at milestone-payouts i)),
                     verified: false,
                     verified-at: none
                   }
                 )
                 (list u0 u1 u2 u3 u4 u5 u6 u7 u8 u9))))
      (map-set contract-milestones contract-id (filter (lambda (m) (< (get id m) milestone-count)) milestones))
    )

    (map-set milestone-counter contract-id milestone-count)
    (try! (nft-mint? maintenance-contract contract-id tx-sender))
    (var-set next-contract-id (+ contract-id u1))
    (print { event: "contract-created", id: contract-id, asset: asset-id })
    (ok contract-id)
  )
)

(define-public (update-contract-status (contract-id uint) (new-status (string-ascii 20)))
  (let ((contract (unwrap! (map-get? contracts contract-id) (err ERR-CONTRACT-EXISTS))))
    (asserts! (is-eq (get creator contract) tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (or (is-eq new-status "open") (is-eq new-status "active") (is-eq new-status "closed")) (err ERR-INVALID-STATUS))
    (map-set contracts contract-id (merge contract { status: new-status }))
    (ok true)
  )
)

(define-public (verify-milestone (contract-id uint) (milestone-id uint))
  (let (
    (contract (unwrap! (get-contract contract-id) (err ERR-CONTRACT-EXISTS)))
    (milestones (unwrap! (get-milestones contract-id) (err ERR-MILESTONE-NOT-FOUND)))
    (milestone (unwrap! (element-at milestones milestone-id) (err ERR-MILESTONE-NOT-FOUND)))
  )
    (asserts! (is-eq (get status contract) "active") (err ERR-CONTRACT-CLOSED))
    (asserts! (not (get verified milestone)) (err ERR-INVALID-STATUS))
    (asserts! (is-some (var-get oracle-contract)) (err ERR-ORACLE-NOT-SET))

    (let ((updated-milestone (merge milestone { verified: true, verified-at: (some block-height) })))
      (map-set contract-milestones contract-id
        (replace-at? milestones milestone-id updated-milestone))
      (print { event: "milestone-verified", contract: contract-id, milestone: milestone-id })
      (ok true)
    )
  )
)

(define-public (close-contract (contract-id uint))
  (let ((contract (unwrap! (get-contract contract-id) (err ERR-CONTRACT-EXISTS))))
    (asserts! (or (is-eq (get creator contract) tx-sender) (is-eq tx-sender (unwrap-panic (var-get reward-distributor)))) (err ERR-UNAUTHORIZED))
    (asserts! (> block-height (get end-block contract)) (err ERR-INVALID-TIMELINE))
    (map-set contracts contract-id (merge contract { status: "closed" }))
    (ok true)
  )
)