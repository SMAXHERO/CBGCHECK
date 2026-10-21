"""cbg_inspector —— 阴阳师藏宝阁「看号工具」本地蒸馏实现。

模块划分（对应站点 yys-cbg-inspector 的各个功能）：

    static      静态资料（式神基础面板 / 御魂套装属性）
    fetch       数据获取（Server Action 重放、CBG get_equip_detail 直连）
    dataset     原始导出 -> schemaVersion 11 数据集（对应站点 chunk 9032）
    speed       速度盘点（散件一速 / 满速统计 / 套件速度表 / 一速组合）
    pve         PVE 御魂评分与逢魔组合面板（对应 chunk 45072 + worker 引擎）
    hero        式神技能统计（御魂达摩 / 多号机 / 技能未达标 / 联动）
    relics      御魂库存统计与筛选
    calculator  御魂组合搜索（面板 / 伤害指标，对应 worker 引擎 QS）
"""

__version__ = "0.1.0"
