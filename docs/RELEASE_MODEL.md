# Release Model

Packages release through internal package publishing. Pages and fragments consume package versions and rebuild.

Fragments expose stable, canary, preview, and explicit versions through `platform/fragment-registry`.

Pages expose stable route entries through `platform/route-registry`.

Rollback is registry-driven for page and fragment traffic where possible. Shell rollback uses the shell deployment controller.
