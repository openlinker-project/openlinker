# @openlinker/integrations-__name__

> **Status: scaffolded — capabilities not yet implemented.**

This package implements the OpenLinker capability ports for `__name__`.
See [`docs/plugin-author-guide.md`](../../../docs/plugin-author-guide.md) for the walkthrough — what files to add, which port to implement, and how the host picks up your adapter.

The integration module is currently the `createNestAdapterModule` helper form. When you add your first plugin-specific `@Injectable` provider (a repository, provisioner, HTTP client, refresh service), swap to the inline-from-module pattern documented in the guide § Step 6 *Two authoring patterns*.
