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

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? 'Renderer evaluation failed.');
  }
  return response.result.value;
}

const result = await evaluate(`(async () => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const doubleFrame = async () => { await frame(); await frame(); };
  const itemList = document.querySelector('.item-list');
  const reader = document.querySelector('.reader-pane');
  const sidebar = document.querySelector('.sidebar');
  const readerMain = document.querySelector('main');
  if (!itemList || !reader || !sidebar || !readerMain) {
    throw new Error('Reader panes were not rendered: ' + document.body.innerText.slice(0, 500));
  }

  const palette = {
    background: getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
    sidebar: getComputedStyle(document.documentElement).getPropertyValue('--sidebar').trim(),
    text: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
    highlight: getComputedStyle(document.documentElement).getPropertyValue('--highlight').trim(),
  };
  const expectedPalette = {background: '#171615', sidebar: '#1E1D1B', text: '#D6D5D4', highlight: '#4E99A3'};
  if (Object.entries(expectedPalette).some(([key, value]) => palette[key].toUpperCase() !== value)) {
    throw new Error('Approved palette variables are not active: ' + JSON.stringify(palette));
  }

  const sidebarToggle = document.querySelector('.sidebar-toggle');
  if (!sidebarToggle) throw new Error('Sidebar collapse control was not rendered.');
  const expandedSidebarWidth = sidebar.getBoundingClientRect().width;
  sidebarToggle.click();
  await doubleFrame();
  const collapsedSidebarWidth = sidebar.getBoundingClientRect().width;
  const collapsedIconOnly = document.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')
    && getComputedStyle(document.querySelector('.nav-text')).display === 'none';
  if (!collapsedIconOnly || collapsedSidebarWidth >= expandedSidebarWidth) throw new Error('Sidebar did not collapse to its icon rail.');
  sidebarToggle.click();
  await doubleFrame();

  const fullscreenButton = [...reader.querySelectorAll('button')]
    .find((button) => button.getAttribute('aria-label') === 'Enter fullscreen reader mode');
  if (!fullscreenButton) throw new Error('Fullscreen reader control was not rendered.');
  fullscreenButton.click();
  await doubleFrame();
  const fullscreenReader = document.querySelector('.reader-grid')?.classList.contains('reader-expanded')
    && getComputedStyle(itemList).display === 'none'
    && sidebar.getBoundingClientRect().width === expandedSidebarWidth;
  if (!fullscreenReader) throw new Error('Fullscreen reader did not preserve the sidebar while hiding the item list.');
  [...reader.querySelectorAll('button')]
    .find((button) => button.getAttribute('aria-label') === 'Exit fullscreen reader mode')?.click();
  await doubleFrame();

  const articleContent = reader.querySelector('.article-content');
  if (!articleContent) throw new Error('Article content was not rendered for the table smoke check.');
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Column</th><th>Value</th></tr></thead><tbody><tr><td>Example</td><td>12</td></tr></tbody>';
  articleContent.append(table);
  const tableStyle = getComputedStyle(table);
  const cellStyle = getComputedStyle(table.querySelector('td'));
  const tableRendering = {
    display: tableStyle.display,
    overflowX: tableStyle.overflowX,
    cellBorderStyle: cellStyle.borderTopStyle,
    cellPadding: cellStyle.paddingLeft,
  };
  table.remove();
  if (tableRendering.display !== 'block' || tableRendering.overflowX !== 'auto'
    || tableRendering.cellBorderStyle !== 'solid' || Number.parseFloat(tableRendering.cellPadding) <= 0) {
    throw new Error('Article table styling is incomplete: ' + JSON.stringify(tableRendering));
  }

  const itemFiller = document.createElement('div');
  const readerFiller = document.createElement('div');
  itemFiller.style.height = '1600px';
  readerFiller.style.height = '1800px';
  itemList.append(itemFiller);
  reader.append(readerFiller);
  itemList.scrollTop = 140;
  reader.scrollTop = 260;
  await frame();
  reader.scrollTop = 420;
  await frame();
  const readerState = {
    bodyScroll: document.documentElement.scrollTop || document.body.scrollTop,
    bodyOverflow: getComputedStyle(document.body).overflowY,
    mainOverflow: getComputedStyle(readerMain).overflowY,
    itemOverflow: getComputedStyle(itemList).overflowY,
    readerOverflow: getComputedStyle(reader).overflowY,
    itemScrollAfterReaderMoved: itemList.scrollTop,
    readerScroll: reader.scrollTop,
    sidebarTop: sidebar.getBoundingClientRect().top,
  };
  itemFiller.remove();
  readerFiller.remove();
  itemList.scrollTop = 0;
  reader.scrollTop = 0;

  const sourcesButton = [...document.querySelectorAll('.sidebar button')]
    .find((button) => button.querySelector('.count') && button.querySelector('span')?.textContent === 'Sources');
  if (!sourcesButton) throw new Error('Manage Sources navigation was not rendered.');
  sourcesButton.click();
  await frame();
  await frame();
  const managementMain = document.querySelector('main');
  const content = managementMain?.querySelector('.content-section');
  if (!managementMain || !content) throw new Error('Sources management content was not rendered.');
  const managementFiller = document.createElement('div');
  managementFiller.style.height = '1600px';
  content.append(managementFiller);
  content.scrollTop = 230;
  await frame();
  const managementState = {
    bodyScroll: document.documentElement.scrollTop || document.body.scrollTop,
    mainOverflow: getComputedStyle(managementMain).overflowY,
    contentOverflow: getComputedStyle(content).overflowY,
    contentScroll: content.scrollTop,
    sidebarTop: sidebar.getBoundingClientRect().top,
    importButtonPresent: [...document.querySelectorAll('button')]
      .some((button) => button.textContent?.includes('Import CSV / JSON')),
  };
  const manageButton = [...document.querySelectorAll('.header-actions button')]
    .find((button) => button.textContent?.trim() === 'Manage');
  if (!manageButton) throw new Error('Bulk source Manage action was not rendered.');
  manageButton.click();
  await doubleFrame();
  const selectionToggle = document.querySelector('.source-selection-toggle');
  if (!selectionToggle) throw new Error('Bulk source selection control was not rendered.');
  selectionToggle.click();
  await doubleFrame();
  const stagedCard = selectionToggle.closest('.source-card');
  const confirmButton = [...document.querySelectorAll('.header-actions button')]
    .find((button) => button.textContent?.includes('Delete 1 selected'));
  const sourceSelectionState = {
    staged: stagedCard?.classList.contains('staged-source-removal') ?? false,
    confirmationEnabled: Boolean(confirmButton && !confirmButton.disabled),
  };
  if (!sourceSelectionState.staged || !sourceSelectionState.confirmationEnabled) {
    throw new Error('Bulk source selection was not staged for explicit confirmation.');
  }
  [...document.querySelectorAll('.header-actions button')]
    .find((button) => button.textContent?.trim() === 'Cancel')?.click();
  await doubleFrame();
  sourceSelectionState.cancelCleared = !document.querySelector('.source-card.staged-source-removal')
    && !document.querySelector('.source-selection-toggle');
  if (!sourceSelectionState.cancelCleared) throw new Error('Bulk source selection Cancel did not discard staged changes.');
  managementFiller.remove();
  return {
    viewport: {width: innerWidth, height: innerHeight}, palette,
    sidebar: {expandedSidebarWidth, collapsedSidebarWidth, collapsedIconOnly},
    fullscreenReader, tableRendering, readerState, managementState, sourceSelectionState,
  };
})()`);

console.log(JSON.stringify(result, null, 2));
socket.close();
