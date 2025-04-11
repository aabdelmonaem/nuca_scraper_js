const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

// Global config
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Referer": "https://lands.nuca.gov.eg/",
};

const session = axios.create({ headers });

async function extractHiddenFields($) {
  const ids = [
    "__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION",
    "__EVENTTARGET", "__EVENTARGUMENT", "__LASTFOCUS", "__VIEWSTATEENCRYPTED"
  ];
  const state = {};
  ids.forEach(id => {
    const value = $(`input#${id}`).val();
    if (value !== undefined) state[id] = value;
  });
  return state;
}

function parseTable($) {
  const table = $('#MainContent_grdPlots');
  if (!table.length) return null;

  const headers = table.find('th').map((_, th) => $(th).text().trim()).get();
  const rows = [];

  table.find('tr.row, tr.altrow').each((_, tr) => {
    const cols = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
    if (cols.length === headers.length) {
      rows.push(Object.fromEntries(headers.map((h, i) => [h, cols[i]])));
    }
  });

  return rows;
}

async function scrapeZone(zoneId, districtName, allRows) {
  const baseUrl = `https://lands.nuca.gov.eg/ar/ViewZone.aspx?ID=${zoneId}`;
  let page = 1;

  let response = await session.get(baseUrl);
  let $ = cheerio.load(response.data);
  let state = await extractHiddenFields($);

  while (true) {
    console.log(`📄 Page ${page} | Zone ${zoneId} | ${districtName}`);

    const rows = parseTable($);
    if (!rows || rows.length === 0) break;

    rows.forEach(row => {
      row["ZoneID"] = zoneId;
      row["Page"] = page;
      row["District"] = districtName;
      allRows.push(row);
    });

    const pager = $('tr.footer');
    const nextLink = pager.find(`a:contains('${page + 1}')`);
    if (!nextLink.length) break;

    const href = nextLink.attr('href');
    const match = /__doPostBack\('([^']+)'/.exec(href);
    const eventTarget = match ? match[1] : null;
    if (!eventTarget) break;

    const postData = new URLSearchParams({
      "ctl00$ToolkitScriptManager1": `ctl00$MainContent$pnlPageContainer|${eventTarget}`,
      "__ASYNCPOST": "true",
      "__EVENTTARGET": eventTarget,
      "__EVENTARGUMENT": `Page$${page + 1}`,
      ...state
    });

    response = await session.post(baseUrl, postData.toString(), {
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" }
    });

    const parts = response.data.split('|');
    const htmlFragmentIndex = parts.findIndex(
      (v, i) => v === "updatePanel" && parts[i + 1] === "MainContent_pnlPageContainer"
    );
    if (htmlFragmentIndex === -1) break;

    const fragment = parts[htmlFragmentIndex + 2];
    $ = cheerio.load(fragment);
    state = await extractHiddenFields($);
    page++;
  }
}

(async () => {
  const districts = {
    "District 7": [1508, 1542, 1544, 1545, 1547, 1548, 1549, 1550, 1551],
    "Eest Universities": [1509],
    "Orchid": [1504, 1505, 1506, 1507],
    "Badr-Eastern Extension": [1521],
    "Badr-Central Park": [1522, 1523],
    "May 15th City": [1409],
    "New Minya City-The third tourist area, Zone C": [1417],
  };

  const allRows = [];

  for (const [district, zoneIds] of Object.entries(districts)) {
    for (const zoneId of zoneIds) {
      await scrapeZone(zoneId, district, allRows);
    }
  }

  fs.writeFileSync('all_zones_combined.json', JSON.stringify(allRows, null, 2), 'utf-8');
  console.log(`✅ Done. Total rows: ${allRows.length} saved to all_zones_combined.json`);

//   // Save to CSV
//   const csvHeaders = Object.keys(allRows[0]);
//   const csv = [
//     csvHeaders.join(','),
//     ...allRows.map(row => csvHeaders.map(h => `"${(row[h] || '').replace(/"/g, '""')}"`).join(','))
//   ].join('\n');

//   fs.writeFileSync('all_zones_combined.csv', csv, 'utf-8');
//   console.log(`✅ Done. Total rows: ${allRows.length}`);
})();
