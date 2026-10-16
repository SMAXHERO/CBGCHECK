/**
 * 藏宝阁链接生成。
 *
 * 这里原本还有 loadDataset()——那是「静态快照」模式的数据加载器。
 * 现在面板改成**只走实时查询**（伴随服务 + 已登录浏览器），快照路径已移除，
 * 所以只留下拼链接这个仍然需要的工具函数。
 */

/**
 * 生成藏宝阁商品详情页链接。
 *
 * 末段必须是**订单号 game_ordersn**（我们把行数据的 id 统一成它），
 * 不能用 eid —— 两者形状一模一样（`时间戳-区服-随机串`），用错就跳到不存在的商品页。
 * 证据：站点列表页真实链接 `/cgi/mweb/equip/12/202610160301613-12-SDI0LBZYNXWYY`
 * 对应的是该行的 game_ordersn。
 * 核对脚本：tools/cbg/verify_links.py
 */
export const cbgDetailUrl = (row: { server_id: number | null; id: string }): string =>
  `https://yys.cbg.163.com/cgi/mweb/equip/${row.server_id ?? ''}/${row.id}`;
