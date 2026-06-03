/**
 * Cloudflare Worker: 琵琶湖データプロキシ
 *
 * デプロイ手順:
 *   1. https://dash.cloudflare.com → Workers & Pages → Create → Worker
 *   2. このファイルの内容を貼り付けて Deploy
 *   3. 発行された URL を src/pages/monitor.astro の PROXY_BASE に設定
 *
 * エンドポイント:
 *   GET /water-level   琵琶湖水位（リアルタイム10分値）
 *   GET /water-temp    水温（琵琶湖大橋・安曇川沖・雄琴沖）
 *   GET /discharge     放水量（瀬田川洗堰）
 *   GET /history?days=7  過去データ（水位）
 *
 * データソース: 国土交通省 水文水質データベース / 川の防災情報
 */

const STATIONS = {
  level:       { id: "306041286603280", name: "琵琶湖（彦根）", unit: "m" },
  temp_bridge: { ofcCd: "22039", obsCd: "1", name: "琵琶湖大橋",   unit: "℃" },
  temp_north:  { ofcCd: "22040", obsCd: "4", name: "安曇川沖中央", unit: "℃" },
  temp_south:  { ofcCd: "22040", obsCd: "3", name: "雄琴沖中央",   unit: "℃" },
  discharge:   { ofcCd: "21281", obsCd: "6", name: "瀬田川洗堰",   unit: "m³/s" },
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
const dateStr = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

async function fetchRiverDB(id, kind = 9) {
  // Step 1: main page (contains iframe URL to actual data)
  const mainUrl = `http://www1.river.go.jp/cgi-bin/DspWaterData.exe?KIND=${kind}&ID=${id}`;
  const mainRes = await fetch(mainUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; BiwakoProxy/1.0)" } });
  if (!mainRes.ok) throw new Error(`river.go.jp main error: ${mainRes.status}`);
  const mainHtml = await mainRes.text();
  // Step 2: extract iframe src
  const m = mainHtml.match(/<IFRAME\s+src="([^"]+)"/i);
  if (!m) throw new Error("data iframe not found");
  const iframeUrl = m[1].startsWith("http") ? m[1] : `http://www1.river.go.jp${m[1]}`;
  // Step 3: fetch actual data
  const dataRes = await fetch(iframeUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; BiwakoProxy/1.0)" } });
  if (!dataRes.ok) throw new Error(`river.go.jp iframe error: ${dataRes.status}`);
  return dataRes.text();
}

async function fetchKawabou(ofcCd, obsCd, itmkndCd) {
  const url = `https://www.river.go.jp/nrpc0305gDisp.do?officeCode=${ofcCd}&obsrvtnPointCode=${obsCd}&timeAxis=10&itemCode=${itmkndCd}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; BiwakoProxy/1.0)" } });
  if (!res.ok) throw new Error(`kawabou error: ${res.status}`);
  return res.text();
}

function parseTableData(html) {
  // 水文水質DB iframe形式: <TD>YYYY/MM/DD</TD><TD>HH:MM</TD><TD>...<FONT...>VALUE</FONT></TD>
  const rows = [];
  const re = /<TD[^>]*>\s*(\d{4}\/\d{2}\/\d{2})\s*<\/TD>[\s\S]{0,200}?<TD[^>]*>\s*(\d{2}:\d{2})\s*<\/TD>[\s\S]{0,200}?<FONT[^>]*>\s*([\d\.\-]+)\s*<\/FONT>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    rows.push({ time: `${m[1]} ${m[2]}`, value: parseFloat(m[3]) });
  }
  // 古い順にソート（HTMLは新しい順で並んでいる）
  rows.reverse();
  return rows;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    try {
      if (path === "/water-level") {
        const html = await fetchRiverDB(STATIONS.level.id, 9);
        return json({
          station: STATIONS.level.name, unit: STATIONS.level.unit,
          data: parseTableData(html).slice(-144), fetched_at: new Date().toISOString(),
        });
      }
      if (path === "/water-temp") {
        const results = {};
        await Promise.allSettled(["temp_bridge", "temp_north", "temp_south"].map(async (key) => {
          const s = STATIONS[key];
          try {
            const html = await fetchKawabou(s.ofcCd, s.obsCd, 6);
            results[key] = { name: s.name, unit: s.unit, data: parseTableData(html).slice(-144), ok: true };
          } catch (e) {
            results[key] = { name: s.name, unit: s.unit, data: [], ok: false, error: e.message };
          }
        }));
        return json({ results, fetched_at: new Date().toISOString() });
      }
      if (path === "/discharge") {
        const s = STATIONS.discharge;
        const html = await fetchKawabou(s.ofcCd, s.obsCd, 5);
        return json({ station: s.name, unit: s.unit, data: parseTableData(html).slice(-144), fetched_at: new Date().toISOString() });
      }
      if (path === "/history") {
        const days = parseInt(url.searchParams.get("days") || "7", 10);
        const end = new Date(); const start = new Date(end.getTime() - days * 86400000);
        const dbUrl = `http://www1.river.go.jp/cgi-bin/DspWaterGraph.exe?ID=${STATIONS.level.id}&KIND=9&BGNDATE=${dateStr(start)}&ENDDATE=${dateStr(end)}&PID=0`;
        const html = await fetch(dbUrl, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.text());
        return json({ station: STATIONS.level.name, unit: STATIONS.level.unit, days, data: parseTableData(html), fetched_at: new Date().toISOString() });
      }
      if (path === "/" || path === "/health") {
        return json({ status: "ok", endpoints: ["/water-level", "/water-temp", "/discharge", "/history?days=7"] });
      }
      return json({ error: "Not Found" }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
