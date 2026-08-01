# Development workflow

1. Work on `pdf-creation`; keep `main` as the untouched App A baseline until promotion is separately approved.
2. Keep application templates and business schemas outside this repository.
3. Change the JSON Schema and OpenAPI document together.
4. Run typecheck, lint, unit/integration tests, and a production build before review.
5. Label evidence precisely: local tests do not prove Vercel, R2, firewall, lifecycle, or public-link behavior.
6. Do not commit, push, deploy, promote, or change external settings without explicit authorization.

Production implementation proceeds only after the preview acceptance checks in `docs/OPERATIONS.md` pass.
