/**
 * 看号页常量：标签页定义与指标中文名。
 * 从 InspectorReport.tsx 原样迁出（原文件 L27–L50），值与顺序保持不变。
 */

export const TABS = [
  { key: 'overview', label: '账号概览' },
  { key: 'speed', label: '速度盘点' },
  { key: 'pve', label: 'PVE 预览' },
  { key: 'hero', label: '式神技能' },
  { key: 'relics', label: '御魂库存' },
  { key: 'calc', label: '御魂计算器' },
] as const;
export type TabKey = (typeof TABS)[number]['key'];

export const METRIC_LABELS: Record<string, string> = {
  damage: '伤害（攻击 × 暴伤）',
  healing: '治疗（生命 × 暴伤）',
  defenseOutput: '防御输出（防御 × 暴伤）',
  attack: '攻击',
  health: '生命',
  defense: '防御',
  speed: '速度',
  critRate: '暴击',
  critDamage: '暴击伤害',
  effectHit: '效果命中',
  effectResistance: '效果抵抗',
  hitResistance: '命中+抵抗',
};
