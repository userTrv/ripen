// Runs inside the page served by the Ripen server at /dashboard/test.html.
const params = new URLSearchParams(location.search);
const steps = [];

function check(condition, message) {
  if (!condition) throw new Error(message);
  steps.push(message);
}

async function waitFor(predicate, message, timeout = 4000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const value = predicate();
    if (value) {
      steps.push(message);
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out: ${message}`);
}

function setValue(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

async function run() {
  await customElements.whenDefined('ripen-dashboard');
  const root = document.querySelector('ripen-dashboard').shadowRoot;
  const card = (key) => root.querySelector(`article[data-key="${key}"]`);
  const button = (scope, text) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
  const status = () => root.querySelector('[role=status]')?.textContent ?? '';

  // Sign-in
  const token = await waitFor(() => root.querySelector('#token'), 'login form is shown');
  setValue(token, 'wrong-token-of-some-length');
  root.querySelector('form').requestSubmit();
  await waitFor(() => root.querySelector('[role=alert]')?.textContent.includes('not accepted'), 'a wrong token is refused with an explanation');
  setValue(root.querySelector('#token'), params.get('token'));
  root.querySelector('form').requestSubmit();
  await waitFor(() => root.textContent.includes('Release console'), 'the right token opens the console');
  check(sessionStorage.getItem('ripen.dashboard.token') === params.get('token'), 'token is kept for this tab only');
  await waitFor(() => card('search-v2'), 'seeded features are listed');
  check(root.textContent.includes('Regular'), 'channel counts are shown');

  // Create a feature, with validation
  setValue(root.querySelector('#new-key'), 'Bad Key');
  root.querySelector('form.create').requestSubmit();
  check(root.querySelector('form.create .error').textContent.includes('lowercase'), 'invalid keys are explained');
  setValue(root.querySelector('#new-key'), 'dark-mode');
  setValue(root.querySelector('#new-description'), 'Dark theme');
  root.querySelector('form.create').requestSubmit();
  await waitFor(() => card('dark-mode'), 'a new feature appears');
  check(card('dark-mode').querySelector('.pill').textContent === 'Off', 'new features start off');

  // Promote off → early (no gate)
  button(card('dark-mode'), 'Promote to Early').click();
  await waitFor(() => card('dark-mode')?.querySelector('.track .current')?.textContent === 'Early', 'promote moves it to early');
  check(status().includes('now in Early'), 'the result is announced');

  // The seeded search-v2 fails its gate; forcing needs a second click
  const blocked = card('search-v2');
  check(blocked.querySelector('.pill').textContent === 'Gate not passed', 'a blocked feature is marked');
  check(blocked.querySelectorAll('.checks .fail').length > 0, 'failed checks are listed');
  check(blocked.textContent.includes('Login button does nothing'), 'recent reports are shown');
  button(blocked, 'Promote to Regular').click();
  await waitFor(() => status().includes('did not pass the gate'), 'promoting a blocked feature explains the failed checks');
  button(card('search-v2'), 'Force…').click();
  await waitFor(() => button(card('search-v2'), 'Yes, promote anyway'), 'force asks for confirmation');
  button(card('search-v2'), 'Yes, promote anyway').click();
  await waitFor(() => card('search-v2')?.querySelector('.track .current')?.textContent === 'Regular', 'forced promotion moves it');

  // History and kill switch
  const details = card('search-v2').querySelector('details');
  details.open = true;
  await waitFor(() => card('search-v2')?.querySelector('.history')?.textContent.includes('(forced)'), 'history shows the forced move and actor');
  check(card('search-v2').querySelector('.history').textContent.includes('browser-test'), 'actor is recorded');
  button(card('search-v2'), 'Turn off').click();
  await waitFor(() => card('search-v2')?.querySelector('.pill')?.textContent === 'Off', 'turn off disables it for everyone');

  // Sign out
  button(root, 'Sign out').click();
  await waitFor(() => root.querySelector('#token'), 'sign out returns to the login form');
  check(sessionStorage.getItem('ripen.dashboard.token') === null, 'sign out forgets the token');
}

run()
  .then(() => ({ ok: true, steps }))
  .catch((error) => ({ ok: false, steps, error: String((error && error.stack) || error) }))
  // The dashboard's CSP blocks requests to other origins, so the result leaves by navigation.
  .then((result) => {
    location.href = `${params.get('report')}?r=${encodeURIComponent(JSON.stringify(result))}`;
  });
