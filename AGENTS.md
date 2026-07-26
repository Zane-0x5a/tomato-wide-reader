# Tomato Project Guardrails

Before planning, implementation, or review, read `SPEC.md` in full.

This project protects long-session reading comfort, semantic content integrity, and reliable control of a full-viewport paginated reader. It is not complete when a narrow page merely becomes wider, when CSS columns still scroll vertically, or when a demo paginates only a happy-path chapter.

Every implementation and release review must re-check:

- lossless static text and image layout;
- chapter/spread sequence and semantic position preservation;
- restrained, validated motion;
- typography and density controls;
- compatibility with Fanqie's account progress and content boundaries;
- itemized sad-path and real-session closure against `SPEC.md`.

Treat the release-blocker coverage matrix in `SPEC.md` as active scope. Keep missing and partial capabilities visible until they are verified complete. Publication VIP books currently have no browser content source and must remain explicit non-support unless new official evidence changes that conclusion.
