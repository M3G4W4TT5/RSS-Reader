const endpoint = process.argv[2];
if (!endpoint) throw new Error('Pass a renderer WebSocket debugging URL.');

const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, {once: true});
  socket.addEventListener('error', reject, {once: true});
});

let requestId = 0;
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const receive = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener('message', receive);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    };
    socket.addEventListener('message', receive);
    socket.send(JSON.stringify({id, method, params}));
  });
}

const response = await call('Runtime.evaluate', {
  expression: `(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const waitFor = async (read, message) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const value = read();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(message);
    };
    const buttonWithText = (scope, text) => [...scope.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === text);

    await waitFor(() => document.querySelector('.sidebar nav'), 'Application did not finish loading.');
    const collectionsButton = document.querySelector('.sidebar nav button[title="Manage collections"]');
    if (!collectionsButton) throw new Error('Collections management navigation was not found.');
    collectionsButton.click();
    await frame();

    const collectionCard = await waitFor(
      () => document.querySelector('.collection-card'),
      'No collection is available for the editor smoke test.',
    );
    const editButton = buttonWithText(collectionCard, 'Edit');
    if (!editButton) throw new Error('Collection Edit button was not found.');
    editButton.click();
    await frame();

    const editor = await waitFor(
      () => document.querySelector('.collection-editor-modal'),
      'Collection editor did not open.',
    );
    const membershipList = editor.querySelector('.membership-list');
    const iconChoices = editor.querySelectorAll('input[name="collection-icon"]');
    if (iconChoices.length !== 9 || !editor.querySelector('input[name="collection-icon"]:checked')) {
      throw new Error('Curated collection icon picker was not rendered with the current choice selected.');
    }
    const initialMembershipCount = editor.querySelectorAll('.membership-row').length;
    if (!membershipList) throw new Error('Current source list was not rendered.');
    const membershipStyle = getComputedStyle(membershipList);
    if (membershipStyle.overflowY !== 'auto') throw new Error('Current source list is not independently scrollable.');
    if (editor.querySelectorAll('.remove-membership-button').length !== initialMembershipCount) {
      throw new Error('A staged remove control was not rendered for every current source.');
    }

    const addButton = buttonWithText(editor, '＋ Add sources');
    if (!addButton) throw new Error('Add sources button was not found.');
    addButton.click();
    await frame();

    const picker = await waitFor(
      () => document.querySelector('.source-picker-modal'),
      'Source picker did not open.',
    );
    const search = picker.querySelector('input[type="search"]');
    const pickerList = picker.querySelector('.source-picker-list');
    if (!search || !pickerList) throw new Error('Picker search or source list is missing.');
    const pickerListScrollable = getComputedStyle(pickerList).overflowY === 'auto';
    if (!pickerListScrollable) throw new Error('Source picker list is not scrollable.');
    const existingRows = [...picker.querySelectorAll('.source-picker-row.existing')];
    if (existingRows.some((row) => !row.querySelector('input:disabled'))) {
      throw new Error('An existing source is still addable.');
    }

    const candidate = [...picker.querySelectorAll('.source-picker-row:not(.existing)')][0];
    let pickerCancelPreservedMembership = true;
    let searchMatchedNameOrUrl = true;
    if (candidate) {
      const candidateUrl = candidate.querySelector('small')?.textContent ?? '';
      const query = new URL(candidateUrl).hostname.split('.')[0];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(search, query);
      search.dispatchEvent(new Event('input', {bubbles: true}));
      await frame();
      const visibleRows = [...picker.querySelectorAll('.source-picker-row')];
      searchMatchedNameOrUrl = visibleRows.length > 0 && visibleRows.every((row) =>
        row.textContent.toLowerCase().includes(query.toLowerCase()),
      );
      setter.call(search, '');
      search.dispatchEvent(new Event('input', {bubbles: true}));
      await frame();
      const selectable = picker.querySelector('.source-picker-row:not(.existing) input');
      selectable.click();
      await frame();
      const pickerCancel = buttonWithText(picker, 'Cancel');
      pickerCancel.click();
      await frame();
      pickerCancelPreservedMembership = editor.querySelectorAll('.membership-row').length === initialMembershipCount;
    } else {
      buttonWithText(picker, 'Cancel').click();
      await frame();
    }

    if (!searchMatchedNameOrUrl) throw new Error('Picker URL/name search did not filter correctly.');
    if (!pickerCancelPreservedMembership) throw new Error('Picker Cancel changed staged membership.');
    const saveButtonPresent = Boolean(buttonWithText(editor, 'Save changes'));
    buttonWithText(editor, 'Cancel').click();
    await frame();
    const outerCancelClosedEditor = !document.querySelector('.collection-editor-modal');

    return {
      collectionName: collectionCard.querySelector('h2')?.textContent,
      initialMembershipCount,
      curatedIconChoiceCount: iconChoices.length,
      existingSourcesHighlightedAndDisabled: existingRows.length === 0
        || existingRows.every((row) => Boolean(row.querySelector('input:disabled'))),
      currentListScrollable: membershipStyle.overflowY === 'auto',
      pickerListScrollable,
      searchMatchedNameOrUrl,
      pickerCancelPreservedMembership,
      saveButtonPresent,
      outerCancelClosedEditor,
    };
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

if (response.exceptionDetails) {
  throw new Error(response.exceptionDetails.exception?.description ?? 'Renderer evaluation failed.');
}

console.log(JSON.stringify(response.result.value, null, 2));
socket.close();
