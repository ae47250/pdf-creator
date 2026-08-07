# Shared-service retention and idempotency evidence

## Scope and evidence class

This report records the bounded Vercel Preview verification for draft PR #9. It is Preview-only evidence for commit `47baf134f9c0bd271b046dbaeda03fc817e0aa22`; it is not Production PDF evidence, caller activation, or proof that a time-dependent R2 deletion has occurred.

The verified deployment was `dpl_5v7EZV4wRn7RwGxD6BA2dBLU1JSU`. Vercel reported it Ready, targeted to Preview, sourced from branch `codex/pdf-shared-service-retention-idempotency`, and attributed to the exact commit above. The six approved test values were copied without rotation or disclosure into sensitive Preview variables scoped only to that branch.

## Safety preflight

- Test-bucket `HeadBucket`: HTTP 200.
- Production-bucket `HeadBucket` using the Preview test credentials: HTTP 403.
- The test-bucket lifecycle configuration passed the existing read-only rule validator before any campaign storage write.
- The test bucket initially contained exactly the three previously ledgered lifecycle canaries and no unidentified object.
- All HTML was fictional and 208 bytes. Request JSON remained below 8,000 bytes. The largest observed PDF was 12,544 bytes, below the 500,000-byte campaign cap.
- No Production application request, Production object write, Production object read, or Production configuration change occurred during this campaign.

## Exact request usage

The campaign initiated exactly 15 of the authorized maximum 15 Preview application requests. Every attempt counted, there were zero retries, and concurrency was one except for the single identical-request race at concurrency two.

| Request category | Count | Result |
| --- | ---: | --- |
| Unauthorized PDF POST | 1 | Rejected with `401 unauthorized` |
| Stored POST missing `idempotencyKey` | 1 | Rejected with `400 invalid_request` before storage |
| Valid direct non-stored POST | 1 | Valid PDF; complete bucket snapshot unchanged |
| Stored POST attempts | 6 | Without HTML, with HTML, identical replay, changed-payload conflict, and two simultaneous identical race attempts completed as expected |
| Report GETs | 6 | View/download for two reports succeeded before expiry; view/download returned `410 report_expired` after the exact campaign-owned manifest was expired |
| **Total** | **15** | **No retry and no request beyond budget** |

## Contract results

- Identical key plus identical semantic payload returned the original report with `storage.idempotentReplay:true` and did not create a second lasting report.
- Identical key plus changed metadata returned `409 idempotency_conflict` without changing the stored object set.
- The concurrency race returned one report ID, left exactly one durable report and one caller-scoped mapping, and reported an idempotent replay to one participant.
- Every stored manifest identified caller `test`; report artifacts used only the campaign report prefix plus `Test/`, and mappings used only `Test/idempotency/`. No other caller prefix changed.
- The direct request created no report, HTML, manifest, or mapping.
- Stored PDF and optional HTML objects matched their manifest, retention prefix, and one-day logical expiry.
- View and download routes returned the expected dispositions and PDF integrity before expiry. Both routes returned the documented `410 report_expired` behavior afterward.

## Cleanup and canaries

The campaign tracked ten exact owned objects: three caller-scoped idempotency mappings and the PDF, optional HTML, and manifest objects for the three unique stored operations. Cleanup used only those exact keys. The post-cleanup full-bucket snapshot exactly matched the pre-campaign snapshot, leaving zero campaign object.

All three pre-existing canaries had unchanged ETag, size, last-modified timestamp, and lifecycle-expiration metadata before and after the campaign. No canary was created, overwritten, expired, or deleted.

## Qualification boundary

This evidence verifies PR #9's stored-request idempotency contract and isolated Preview storage behavior. It does not claim that current Production lifecycle rules implement the approved 2/8/31-day backstops, that physical lifecycle deletion has been observed, that any caller is activated, or that the service is qualified beyond its supported basic-PDF contract.
