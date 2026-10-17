/**
 * probe_prefab_teams.mjs — 探一条商品的「御魂搭配方案」数据。
 *
 * 商品详情接口：GET /cgi/api/get_equip_detail?client_type=h5&serverid=<id>&eid=<eid>
 *   - serverid + eid 必须配对（见 docs/filter-sources.md 6.1）
 *   - 角色数据在 equip.equip_desc（约 1.6MB 的 JSON 字符串）
 *
 * 搭配方案疑似在 equip_desc.prefab_team —— 这个脚本先摸清它的结构，
 * 再把指定式神（默认 须佐之男 / 阿修罗）的方案完整打出来。
 *
 * 用法：
 *   node tools/cbg/probe_prefab_teams.mjs --url "https://yys.cbg.163.com/cgi/mweb/equip/47/202610161701616-47-C8MSKXBXH4B4E"
 *   node tools/cbg/probe_prefab_teams.mjs --url "..." --hero 须佐之男 --hero 阿修罗
 */

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const argAll = (name) => {
  const out = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
};

const PAGE_URL = arg('url', '');
const HEROES = argAll('hero');
const OUT = arg('out', 'D:/deepseek_work/.tmp/prefab-teams.json');

if (!PAGE_URL) {
  console.error('用法: node tools/cbg/probe_prefab_teams.mjs --url "<商品页地址>" [--hero 须佐之男 ...]');
  process.exit(1);
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0';

/** 从商品页地址里取出 serverid 与 ordersn（ordersn 也就是 eid 的第二段来源） */
function parseUrl(u) {
  // 形如 /cgi/mweb/equip/47/202610161701616-47-C8MSKXBXH4B4E
  const m = u.match(/\/equip\/(\d+)\/([0-9]+-\d+-[A-Z0-9]+)/i);
  if (!m) throw new Error('地址里解析不出 serverid / ordersn：' + u);
  return { serverid: m[1], ordersn: m[2] };
}

async function fetchDetail(serverid, eid) {
  const url =
    `https://yys.cbg.163.com/cgi/api/get_equip_detail?client_type=h5` +
    `&serverid=${serverid}&eid=${encodeURIComponent(eid)}`;
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/plain, */*',
      referer: 'https://yys.cbg.163.com/cgi/mweb/pl?search_type=role',
    },
  });
  const text = await res.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: false, why: 'NON_JSON: ' + text.slice(0, 120) };
  }
  if (j.status !== 1 || !j.equip) {
    return { ok: false, why: `${j.status_code ?? ''} ${j.msg ?? 'NO_EQUIP'}`, raw: j };
  }
  return { ok: true, equip: j.equip };
}

const main = async () => {
  const { serverid, ordersn } = parseUrl(PAGE_URL);
  console.log(`解析地址: serverid=${serverid}  ordersn=${ordersn}`);

  // eid 与 ordersn 常常不同：ordersn 是"上架流水号"，eid 是"商品实体 id"。
  // 详情接口要 eid，先用 ordersn 试，失败再想办法（列表接口能给出对应关系）。
  let eid = ordersn;
  console.log(`先按 ordersn 当 eid 试: ${eid}`);
  let d = await fetchDetail(serverid, eid);
  if (!d.ok) {
    console.log(`  失败：${d.why}`);
    console.log('  → 需要先用列表接口拿到该商品的 eid（ordersn 与 eid 通常不同）');
    process.exit(2);
  }

  console.log(`  成功：${d.equip.game_ordersn}  status=${d.equip.status}(${d.equip.status_desc})  ¥${(d.equip.price || 0) / 100}`);
  console.log(`  eid=${d.equip.eid}`);

  let desc = {};
  try {
    desc = JSON.parse(d.equip.equip_desc || '{}');
  } catch (e) {
    console.error('  equip_desc 解析失败: ' + e.message);
    process.exit(3);
  }

  console.log();
  console.log('=== equip_desc 里与「搭配/预设/队伍」相关的字段 ===');
  for (const k of Object.keys(desc)) {
    if (/prefab|team|preset|dapei|yuhun|equip/i.test(k)) {
      const v = desc[k];
      const shape = Array.isArray(v) ? `数组(${v.length})` : v && typeof v === 'object' ? `对象(${Object.keys(v).length})` : typeof v;
      console.log(`  ${k.padEnd(24)} ${shape}`);
    }
  }

  const pt = desc.prefab_team;
  console.log();
  console.log('=== prefab_team 结构 ===');
  if (pt === undefined) {
    console.log('  没有 prefab_team 字段');
  } else if (Array.isArray(pt)) {
    console.log(`  数组，${pt.length} 项`);
    if (pt[0]) {
      console.log(`  第 1 项的键: ${JSON.stringify(Object.keys(pt[0]))}`);
      console.log(`  第 1 项（截断 800 字）: ${JSON.stringify(pt[0]).slice(0, 800)}`);
    }
  } else if (pt && typeof pt === 'object') {
    console.log(`  对象，键: ${JSON.stringify(Object.keys(pt)).slice(0, 400)}`);
  } else {
    console.log(`  值: ${JSON.stringify(pt)}`);
  }

  // 把完整原始数据存下来，便于后续分析
  const fs = await import('node:fs');
  fs.writeFileSync(
    OUT,
    JSON.stringify({ serverid, ordersn, eid: d.equip.eid, equip_status: d.equip.status, prefab_team: pt ?? null }, null, 1),
    'utf8',
  );
  console.log();
  console.log(`  已保存 prefab_team 到 ${OUT}`);
  if (HEROES.length) console.log(`  （待匹配式神: ${HEROES.join('、')}）`);
};

main()
  .then(() => {
    // 注意：不要在这里直接 process.exit()。
    // fetch 的 socket 还在关闭途中时强制退出，Windows 上会触发
    // libuv 断言崩溃（Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)），
    // 表现为退出码 -1073740791。让事件循环自己收尾即可。
    process.exitCode = 0;
  })
  .catch((e) => {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  });
