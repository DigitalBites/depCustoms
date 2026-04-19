# Upstream Tracking

This directory is a vendored subtree import of `supabase/auth`.

Pinned upstream:

- Repository: `https://github.com/supabase/auth`
- Imported ref: `v2.186.0`

Import command used:

```bash
git subtree add --prefix=third_party/supabase-auth https://github.com/supabase/auth.git v2.186.0 --squash
```

Suggested upgrade command:

```bash
git subtree pull --prefix=third_party/supabase-auth https://github.com/supabase/auth.git <new-tag> --squash
```

Local packaging changes for the all-in-one image should live outside this subtree whenever possible.
