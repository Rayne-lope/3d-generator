---
description: Undo the last change to an asset (restores the previous saved version)
argument-hint: <slug | set:name>
allowed-tools: Bash(node studio:*), Read
---

Undo the last step on `$ARGUMENTS`.

1. `node studio history <target>` to see where the working copy stands.
2. `node studio undo <target>`. With unsaved changes it returns to the last saved version
   (the changes are auto-saved first); otherwise it returns to the version the current one was
   made from. Every step can be reversed with `node studio revert <target> <vNNN>`.
3. `node studio diff <target> <the version you left> working` and open the diff sheet to confirm
   what was rolled back.
4. Reply: which version is restored now (its message), what was undone, and how to get it back.
