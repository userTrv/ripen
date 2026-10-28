# @ripen/dashboard

The Ripen release console as a web component, `<ripen-dashboard>`: channels with subscriber counts, features with their stage, gate checks and recent reports; create, promote, roll back, turn off, force with confirmation, history. No dependencies.

The server serves it at `/dashboard/` when `RIPEN_DASHBOARD_DIR` points to this package's `dist` (the Docker image does this). It can also be embedded in your own admin pages:

```html
<ripen-dashboard api="https://ripen.example.com" actor="ops"></ripen-dashboard>
<script type="module">
  import { defineRipenDashboard } from '@ripen/dashboard';
  defineRipenDashboard();
</script>
```

Sign-in uses the admin token, kept in `sessionStorage` of the tab. Embedded on another origin, the admin API must be reachable from it (the server sends CORS headers only for the client API, so serve both from one origin or proxy).

## License

Apache-2.0. Part of [Ripen](https://github.com/userTrv/ripen): stability channels chosen by users, features promoted on real signals.
