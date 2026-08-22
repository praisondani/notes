# Product

## Register

product

## Users

Primary user is one person who wants private notes available in a browser and on a self-hosted Unix server. The user captures text, images, files, links, lists, and references, then organizes them with folders, groups, filters, and search. Keyboard and mouse must provide equivalent access to core actions.

The first release optimizes for personal private notes. Small private groups can follow once the personal workflow is dependable.

## Product Purpose

This is a minimal, customizable, self-hostable private note workspace. It should feel fast enough for quick capture, structured enough for retrieval, and transparent enough that users can run it on their own device or server without being tied to the original maintainer's accounts.

The web app is the first client. Storage must use an S3-compatible interface so users can choose Cloudflare R2, another object store, or a local-compatible service. The project must be open source, versioned, tested, documented, and installable with one command where practical. Future clients may target iOS, Android, macOS, and Windows.

## Brand Personality

Quiet, precise, private.

Copy and interaction should feel calm, direct, and trustworthy. The interface should help users think and retrieve information without competing for attention.

## Anti-references

Avoid SaaS dashboard clutter: nested cards, decorative gradients, excessive rounding, noisy upsell patterns, and visual density that hides the primary note workflow.

## Design Principles

- Capture first: create and edit a note with minimal friction.
- Keyboard parity: every core mouse action has a discoverable keyboard path.
- Private by default: self-hosting, storage, and account boundaries remain clear.
- Structure without ceremony: folders represent a note's physical location and hierarchy; groups act as project hubs containing folders and direct notes.
- Portable foundations: use open interfaces and replaceable adapters so local and hosted deployments behave alike.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Core workflows must support keyboard navigation, visible focus, logical tab order, semantic labels, screen readers, sufficient contrast, and no pointer-only actions. Motion should be reduced or removed when the user requests reduced motion.

## Reference Direction

Use Notion and Linear as references for clear hierarchy, dense workspace navigation, and composable organization. Do not copy their visual identity or reproduce dashboard clutter.
