# -*- coding: utf-8 -*-
"""
calc_demo.py —— 「yys照妖镜」(91zhaoyaojing.com) 客户端计算逻辑的 Python 复刻与验证。

复刻来源（全部为反编译产物，偏移为该文件内字符偏移，0-based）：
  * assets/assets_calculatorWorker-27a82e97.js   —— Web Worker 计算核心（onmessage @93825）
  * chunks/assets_calculator-4b0de9bb.js        —— 主线程过滤/裁剪/组合生成/批量调度 (Pt @19313)
  * chunks/assets_teamBase-e0e42ee9.js          —— 面板/指标换算/固定挂件预设
  * chunks/assets_server-30aaffa2.js            —— yyx 标准化 + 御魂 indicator 公式
  * chunks/assets_pvePreview-699e5d15.js        —— PVE 预览页预设
  * chunks/assets_oneKeyCalcTeam-f0de1561.js    —— 一键预设阵容与搜索策略

用法：
  set PYTHONIOENCODING=utf-8
  python calc_demo.py                      # 默认用官方示例数据跑全部演示
  python calc_demo.py --data yyx_full.json # 用真实账号数据
  python calc_demo.py --quick              # 只跑 1 组一速（更快）

输出分节，每节末尾给出 PASS/FAIL/DELTA 供对拍。
"""
import json
import math
import os
import sys
import time
import heapq
import argparse
from itertools import permutations

# ============================================================================
# 0. 常量表（由 bundle 静态提取；见各注释中的字符偏移）
# ============================================================================

# 御魂副属性/主属性的"单次成长量" —— calculator-4b0de9bb.js @4322  We 表
# 用途：成长次数 = 属性值 / (init * grate[quality-1])，即 pruneScore 与 indicator 的共同单位
INIT_GRATE = {
    'Hp': (114, [.4, .5, .6, .7, .8, 1]),
    'Defense': (5, [.4, .5, .6, .7, .8, 1]),
    'Attack': (27, [.4, .5, .6, .7, .8, 1]),
    'HpRate': (.03, [.4, .5, .6, .7, .8, 1]),
    'DefenseRate': (.03, [.4, .5, .6, .7, .8, 1]),
    'AttackRate': (.03, [.4, .5, .6, .7, .8, 1]),
    'Speed': (3, [.4, .5, .6, .7, .8, 1]),
    'CritRate': (.03, [.4, .5, .6, .7, .8, 1]),
    'CritPower': (.04, [.4, .5, .6, .7, .8, 1]),
    'EffectResistRate': (.04, [.4, .5, .6, .7, .8, 1]),
    'EffectHitRate': (.04, [.4, .5, .6, .7, .8, 1]),
}

# 二号位/四号位/六号位主属性单次成长率 —— yuhuninfo @8726 en 表（用于核对主属性满值）
MAIN_ATTR_RATE = {
    'DefenseRate': .16, 'AttackRate': .08, 'CritRate': .06,
    'HpRate': .16, 'EffectHitRate': .08, 'EffectResistRate': .08,
}

ATTR_CN = {
    'CritPower': '暴击伤害', 'Attack': '攻击', 'Speed': '速度', 'Hp': '生命',
    'Defense': '防御', 'AttackRate': '攻击加成', 'CritRate': '暴击',
    'HpRate': '生命加成', 'DefenseRate': '防御加成',
    'EffectResistRate': '效果抵抗', 'EffectHitRate': '效果命中',
}

# 两件套属性（按御魂 type 归类）—— calculator-4b0de9bb.js @4113 $e()
TWO_PIECE_BY_TYPE = {
    '暴击': {'CritRate': .15},
    '暴击伤害': {'CritPower': .2},
    '攻击加成': {'AttackRate': .15},
    '效果命中': {'EffectHitRate': .15},
    '防御加成': {'DefenseRate': .3},
    '生命加成': {'HpRate': .15},
}

# 目标防御/减伤模型用到的副本 Boss 表 —— calculator-4b0de9bb.js @5173 pe
BOSS_TABLE = {
    '永生之海 P1': {'Boss': {'Hp': 6e5, 'Defense': 678.85857}},
    '永生之海 P2': {'Boat1': {'Hp': 18000, 'Defense': 352},
                    'Boat2': {'Hp': 40000, 'Defense': 352},
                    'Boss': {'Hp': 388888, 'Defense': 0}},
    '魂土': {'P1': {'清姬': {'Hp': 33991.944, 'Defense': 704}},
             'P2': {'黑晴明': {'Hp': 299999.9999, 'Defense': 0}},
             'P3': {'鬼切': {'Hp': 29000.7376, 'Defense': 704}},
             'Boss': {'Hp': 199999.9866, 'Defense': 577.28}},
    '魂王': {'P1': {'络新妇': {'Hp': 130000 + 120000 * .1 * 1.8, 'Defense': 320.32},
                    '阿修罗': {'Hp': 300000 + 120000 * .1 * 1.8, 'Defense': 425},
                    '匣子': {'Hp': 120000}},
             'Boss': {'Hp': 800000, 'Defense': 580, 'Speed': 135}},
    '地域鬼王·极': {'Boss': {'Hp': 630000, 'Defense': 888}},
    '通用阵容': {'Boss': {'Hp': 88888888, 'Defense': 300}},
    '契灵·镇墓兽': {'Boss': {'Hp': 1100240, 'Defense': 600, 'Attack': 11250, 'CritPower': 150}},
    '阴阳师': {'晴明': {'Attack': 3256, 'yuLingAttack': 3126, 'Hp': 27140}},
}

# 式神基础属性 —— worker @83146 lo 表（与 calculator-4b0de9bb.js 的 qe 完全一致）
HERO_EXTRA = {'孔雀明王': {'CritRate': .4, 'EffectHitRate': .75}}   # worker @89875 so

# 技能系数 / 攻击段数（calculator-4b0de9bb.js @16360 x()、@16492 Z()）
HIT_COUNT = {'天照': 6, '须佐之男': 6, '云外镜': 5}
SKILL_COEF = {   # 除下列外默认 1
    '天照': 1.0,
    '须佐之男': 1.0,
    '玉藻前': {1: 1.31, 2: 1.38, 3: 1.587, 4: 1.6675, 5: 1.6675},
    '般若': 1.3,
    '云外镜': 1.45,
    '本真三尾狐': 1.68,
    '秘术·豹袭': None,          # 1.4 + 0.4*skillLevel
}

# ---- 以下两张表由 _scratch/build_tables.py 从 bundle 静态提取后注入 ----
# SUITS: 御魂 id → name/type，yuhuninfo-969a4183.js @6148 的 m 表（72 条）
SUITS = {300010: {'name': '招财猫', 'type': '防御加成'}, 300030: {'name': '破势', 'type': '暴击'}, 300036: {'name': '针女', 'type': '暴击'}, 300021: {'name': '薙魂', 'type': '生命加成'}, 300002: {'name': '雪幽魂', 'type': '防御加成'}, 300035: {'name': '魅妖', 'type': '防御加成'}, 300007: {'name': '三味', 'type': '暴击'}, 300048: {'name': '狂骨', 'type': '攻击加成'}, 300024: {'name': '树妖', 'type': '生命加成'}, 300006: {'name': '涅槃之火', 'type': '生命加成'}, 300026: {'name': '网切', 'type': '暴击'}, 300011: {'name': '反枕', 'type': '防御加成'}, 300013: {'name': '日女巳时', 'type': '防御加成'}, 300032: {'name': '珍珠', 'type': '防御加成'}, 300012: {'name': '轮入道', 'type': '攻击加成'}, 300054: {'name': '蜃气楼', 'type': '首领御魂'}, 300003: {'name': '地藏像', 'type': '生命加成'}, 300022: {'name': '心眼', 'type': '攻击加成'}, 300020: {'name': '鸣屋', 'type': '攻击加成'}, 300018: {'name': '狰', 'type': '攻击加成'}, 300052: {'name': '荒骷髅', 'type': '首领御魂'}, 300034: {'name': '蚌精', 'type': '效果命中'}, 300027: {'name': '阴摩罗', 'type': '攻击加成'}, 300077: {'name': '鬼灵歌伎', 'type': '首领御魂'}, 300015: {'name': '钟灵', 'type': '生命加成'}, 300029: {'name': '伤魂鸟', 'type': '暴击'}, 300023: {'name': '木魅', 'type': '防御加成'}, 300019: {'name': '火灵', 'type': '效果命中'}, 300050: {'name': '土蜘蛛', 'type': '首领御魂'}, 300031: {'name': '镇墓兽', 'type': '暴击'}, 300074: {'name': '兵主部', 'type': '攻击加成'}, 300014: {'name': '镜姬', 'type': '生命加成'}, 300053: {'name': '地震鲶', 'type': '首领御魂'}, 300008: {'name': '魍魉之匣', 'type': '效果抵抗'}, 300004: {'name': '蝠翼', 'type': '攻击加成'}, 300049: {'name': '幽谷响', 'type': '效果抵抗'}, 300051: {'name': '胧车', 'type': '首领御魂'}, 300039: {'name': '返魂香', 'type': '效果抵抗'}, 300075: {'name': '青女房', 'type': '暴击'}, 300033: {'name': '骰子鬼', 'type': '效果抵抗'}, 300073: {'name': '飞缘魔', 'type': '效果命中'}, 300009: {'name': '被服', 'type': '生命加成'}, 300076: {'name': '涂佛', 'type': '生命加成'}, 300079: {'name': '遗念火', 'type': '效果命中'}, 300080: {'name': '共潜', 'type': '效果抵抗'}, 300081: {'name': '恶楼', 'type': '生命加成'}, 300082: {'name': '贝吹坊', 'type': '攻击加成'}, 300083: {'name': '海月火玉', 'type': '暴击'}, 300084: {'name': '出世螺', 'type': '防御加成'}, 300085: {'name': '火之车', 'type': '防御加成'}, 300086: {'name': '隐念', 'type': '攻击加成'}, 300087: {'name': '叠叩', 'type': '生命加成'}, 300088: {'name': '应声虫', 'type': '暴击'}, 300089: {'name': '元兴寺', 'type': '效果命中'}, 300090: {'name': '钓瓶火', 'type': '效果抵抗'}, 300091: {'name': '夜荒魂', 'type': '首领御魂'}, 300092: {'name': '无刀取', 'type': '暴击伤害'}, 300093: {'name': '奉海图', 'type': '防御加成'}, 2: {'name': '首领御魂', 'type': '首领御魂'}, 9: {'name': '星痕御魂', 'type': '星痕御魂'}, 300055: {'name': '片叶之苇', 'type': '暴击'}, 300056: {'name': '尘冢', 'type': '攻击加成'}, 300057: {'name': '油赤子', 'type': '效果命中'}, 300058: {'name': '夜啼石', 'type': '生命加成'}, 300059: {'name': '夜送犬', 'type': '效果抵抗'}, 300060: {'name': '雨降', 'type': '防御加成'}, 300094: {'name': '八咫镜', 'type': '星痕御魂'}, 300095: {'name': '天羽羽斩', 'type': '星痕御魂'}, 300096: {'name': '预言星盘', 'type': '星痕御魂'}, 300097: {'name': '月之石', 'type': '星痕御魂'}, 300098: {'name': '纺缘锤', 'type': '星痕御魂'}, 300099: {'name': '稻荷穗箭', 'type': '星痕御魂'}}
# HEROES: 式神基础面板，calculatorWorker @83146 的 lo 表 / calculator 的 qe 表（54 条）
HEROES = {'神乐': {'Attack': 6382.0, 'Hp': 27140.0, 'Defense': 1051.0, 'Speed': 128.0, 'CritRate': 0.0, 'CritPower': 150.0, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '晴明': {'Attack': 6382.0, 'Hp': 27140.0, 'Defense': 1051.0, 'Speed': 128.0, 'CritRate': 0.0, 'CritPower': 150.0, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '铁鼠': {'Attack': 2921.0, 'Hp': 10709.0, 'Defense': 428.0, 'Speed': 115.0, 'CritRate': 0.08, 'CritPower': 150.0, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '食发鬼': {'Attack': 2894.0, 'Hp': 10709.0, 'Defense': 432.0, 'Speed': 118.0, 'CritRate': 0.08, 'CritPower': 150.0, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '鸦天狗': {'Attack': 2975.0, 'Hp': 10482.0, 'Defense': 428.0, 'Speed': 111.0, 'CritRate': 0.08, 'CritPower': 150.0, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '桃花妖': {'Attack': 2385.0, 'Hp': 11393.0, 'Defense': 490.0, 'Speed': 100.0, 'CritRate': 0.05, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '般若': {'Attack': 3136.0, 'Hp': 10596.0, 'Defense': 397.0, 'Speed': 114.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '吸血姬': {'Attack': 3002.0, 'Hp': 10937.0, 'Defense': 406.0, 'Speed': 115.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '镰鼬': {'Attack': 2680.0, 'Hp': 11621.0, 'Defense': 432.0, 'Speed': 117.0, 'CritRate': 0.05, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '久次良': {'Attack': 2948.0, 'Hp': 9115.0, 'Defense': 485.0, 'Speed': 109.0, 'CritRate': 0.08, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '玉藻前': {'Attack': 3350.0, 'Hp': 12532.0, 'Defense': 353.0, 'Speed': 110.0, 'CritRate': 0.12, 'CritPower': 1.6, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '茨木童子': {'Attack': 3216.0, 'Hp': 10254.0, 'Defense': 397.0, 'Speed': 112.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '阎魔': {'Attack': 2466.0, 'Hp': 11963.0, 'Defense': 454.0, 'Speed': 127.0, 'CritRate': 0.05, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '彼岸花': {'Attack': 3002.0, 'Hp': 11393.0, 'Defense': 388.0, 'Speed': 107.0, 'CritRate': 0.08, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '面灵气': {'Attack': 3243.0, 'Hp': 10140.0, 'Defense': 397.0, 'Speed': 119.0, 'CritRate': 0.08, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '御馔津': {'Attack': 3002.0, 'Hp': 12646.0, 'Defense': 450.0, 'Speed': 119.0, 'CritRate': 0.05, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '鬼切': {'Attack': 3350.0, 'Hp': 10823.0, 'Defense': 353.0, 'Speed': 117.0, 'CritRate': 0.11, 'CritPower': 1.6, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '白藏主': {'Attack': 1822.0, 'Hp': 14241.0, 'Defense': 472.0, 'Speed': 111.0, 'CritRate': 0.05, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '八岐大蛇': {'Attack': 4074.0, 'Hp': 12418.0, 'Defense': 481.0, 'Speed': 118.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '不知火': {'Attack': 3457.0, 'Hp': 9229.0, 'Defense': 397.0, 'Speed': 117.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '大岳丸': {'Attack': 3323.0, 'Hp': 12646.0, 'Defense': 397.0, 'Speed': 100.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '泷夜叉姬': {'Attack': 3511.0, 'Hp': 10026.0, 'Defense': 357.0, 'Speed': 120.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '云外镜': {'Attack': 3028.0, 'Hp': 8317.0, 'Defense': 498.0, 'Speed': 109.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '千姬': {'Attack': 2948.0, 'Hp': 12532.0, 'Defense': 410.0, 'Speed': 121.0, 'CritRate': 0.08, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '不见岳': {'Attack': 2492.0, 'Hp': 12532.0, 'Defense': 538.0, 'Speed': 115.0, 'CritRate': 0.08, 'CritPower': 1.3, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '因幡辉夜姬': {'Attack': 2949.0, 'Hp': 11393.0, 'Defense': 397.0, 'Speed': 113.0, 'CritRate': 0.08, 'CritPower': 1.65, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '炼狱茨木童子': {'Attack': 3323.0, 'Hp': 10254.0, 'Defense': 379.0, 'Speed': 112.0, 'CritRate': 0.15, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '稻荷神御馔津': {'Attack': 3082.0, 'Hp': 11393.0, 'Defense': 485.0, 'Speed': 109.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '初翎山风': {'Attack': 3296.0, 'Hp': 11393.0, 'Defense': 388.0, 'Speed': 116.0, 'CritRate': 0.12, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '阿修罗': {'Attack': 4127.0, 'Hp': 11279.0, 'Defense': 428.0, 'Speed': 119.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '帝释天': {'Attack': 3109.0, 'Hp': 15380.0, 'Defense': 437.0, 'Speed': 111.0, 'CritRate': 0.09, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '食灵': {'Attack': 3028.0, 'Hp': 11393.0, 'Defense': 397.0, 'Speed': 119.0, 'CritRate': 0.08, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '鬼王酒吞童子': {'Attack': 3189.0, 'Hp': 11963.0, 'Defense': 445.0, 'Speed': 109.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '天剑韧心鬼切': {'Attack': 3404.0, 'Hp': 10937.0, 'Defense': 340.0, 'Speed': 119.0, 'CritRate': 0.12, 'CritPower': 1.6, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '空相面灵气': {'Attack': 3162.0, 'Hp': 10482.0, 'Defense': 397.0, 'Speed': 119.0, 'CritRate': 0.05, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '大夜摩天阎魔': {'Attack': 2144.0, 'Hp': 12806.0, 'Defense': 476.0, 'Speed': 123.0, 'CritRate': 0.03, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '心狩鬼女红叶': {'Attack': 3136.0, 'Hp': 11279.0, 'Defense': 370.0, 'Speed': 114.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '神堕八歧大蛇': {'Attack': 4153.0, 'Hp': 13216.0, 'Defense': 437.0, 'Speed': 118.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '神启荒': {'Attack': 3672.0, 'Hp': 13102.0, 'Defense': 432.0, 'Speed': 116.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '月读': {'Attack': 3401.0, 'Hp': 15392.0, 'Defense': 388.0, 'Speed': 118.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '季': {'Attack': 3564.4, 'Hp': 11165.0, 'Defense': 437.0, 'Speed': 118.0, 'CritRate': 0.0, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '流光追月神': {'Attack': 2224.0, 'Hp': 12874.0, 'Defense': 459.0, 'Speed': 111.0, 'CritRate': 0.05, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '孔雀明王': {'Attack': 3538.0, 'Hp': 11165.0, 'Defense': 441.0, 'Speed': 119.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.3, 'EffectResistRate': 0.0}, '须佐之男': {'Attack': 4154.0, 'Hp': 11735.0, 'Defense': 494.0, 'Speed': 112.0, 'CritRate': 0.12, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '纺愿缘结神': {'Attack': 2224.0, 'Hp': 13557.0, 'Defense': 432.0, 'Speed': 108.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '寻森小鹿男': {'Attack': 2680.0, 'Hp': 11735.0, 'Defense': 428.0, 'Speed': 120.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.3}, '天照': {'Attack': 3886.0, 'Hp': 11963.0, 'Defense': 595.0, 'Speed': 119.0, 'CritRate': 0.12, 'CritPower': 1.6, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '伊邪那美': {'Attack': 3618.0, 'Hp': 12077.0, 'Defense': 450.0, 'Speed': 116.0, 'CritRate': 0.2, 'CritPower': 1.5, 'EffectHitRate': 0.2, 'EffectResistRate': 0.0}, '渺念萤草': {'Attack': 3136.0, 'Hp': 10709.0, 'Defense': 397.0, 'Speed': 114.0, 'CritRate': 0.1, 'CritPower': 1.6, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '本真三尾狐': {'Attack': 3350.0, 'Hp': 9684.0, 'Defense': 397.0, 'Speed': 115.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '初音未来': {'Attack': 2171.0, 'Hp': 14013.0, 'Defense': 424.0, 'Speed': 116.0, 'CritRate': 0.09, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '禅心云外镜': {'Attack': 2098.0, 'Hp': 12840.0, 'Defense': 481.0, 'Speed': 113.0, 'CritRate': 0.03, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.75}, '晨晖惠比寿': {'Attack': 2278.0, 'Hp': 12988.0, 'Defense': 445.0, 'Speed': 115.0, 'CritRate': 0.1, 'CritPower': 1.5, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}, '龙吟铃鹿御前': {'Attack': 3270.0, 'Hp': 13557.0, 'Defense': 481.0, 'Speed': 117.0, 'CritRate': 0.1, 'CritPower': 1.8, 'EffectHitRate': 0.0, 'EffectResistRate': 0.0}}

# ============================================================================
# 1. 式神基础面板 / 御魂工具
# ============================================================================

def hero_base(name):
    """worker co() @89875 = {...lo[name]} + 孔雀明王特例"""
    if name not in HEROES:
        raise KeyError('未知式神: ' + name)
    h = dict(HEROES[name])
    h['name'] = name
    ex = HERO_EXTRA.get(name)
    if ex:
        h['CritRate'] = h.get('CritRate', 0) + ex.get('CritRate', 0)
        h['EffectHitRate'] = h.get('EffectHitRate', 0) + ex.get('EffectHitRate', 0)
    return h


def suit_name(sid):
    return SUITS.get(int(sid), {}).get('name', '')


def suit_type(sid):
    return SUITS.get(int(sid), {}).get('type', '')


def is_leader_suit(sid):
    return suit_type(sid) == '首领御魂'


def suits_by_type(types):
    """yuhuninfo vn/Tn: 按主属性类型展开全部套装 id（calculator 的 Le()）"""
    return [sid for sid, s in SUITS.items() if s['type'] in types]


def expand_suit_ids(ids):
    """yuhuninfo vn(): id<100 视为二件套属性类型编号，展开为该类型全部套装"""
    out = []
    for i in ids:
        i = int(i)
        if i < 100:
            # E 表 id→副属性 type
            etype = {1: '防御加成', 2: '首领御魂', 4: '暴击', 5: '生命加成',
                     6: '攻击加成', 7: '暴击伤害', 8: '效果命中', 9: '星痕御魂'}.get(i)
            out.extend(suits_by_type([etype]))
        else:
            out.append(i)
    return out


def two_piece_gain(suit_ids):
    """两件套属性汇总 —— calculator @4113 ke()/ $e()"""
    gain = {}
    for sid in suit_ids:
        for k, v in TWO_PIECE_BY_TYPE.get(suit_type(sid), {}).items():
            gain[k] = gain.get(k, 0) + v
    return gain


def suit_combo_gain(suit_combos):
    """calculator @3895 Ue(n) 的套装部分：count>=2 的套装各算一次 2 件套"""
    counts = {}
    for c in suit_combos:
        counts[int(c['id'])] = counts.get(int(c['id']), 0) + int(c['count'])
    gain = {}
    for sid, cnt in counts.items():
        if cnt >= 2:
            for k, v in TWO_PIECE_BY_TYPE.get(suit_type(sid), {}).items():
                gain[k] = gain.get(k, 0) + v
    return gain


def expand_equips(equips):
    """把固定挂件用的 [{id,count}] 展开成具体的 6 个套装 id（用于主线程预计算）"""
    out = []
    for sc in equips:
        out.extend([int(sc['id'])] * int(sc['count']))
    return out


# ============================================================================
# 2. 御魂预处理（worker 收到的 preComputed* 字段）
# ============================================================================

PRECOMP_KEYS = ['Attack', 'AttackRate', 'Hp', 'HpRate', 'Defense', 'DefenseRate',
                'Speed', 'CritRate', 'CritPower', 'EffectHitRate', 'EffectResistRate']


def precompute(equip):
    """calculator @21010 ut(): base_attr + random_attrs + single_attrs 按 type 求和"""
    p = {k: 0.0 for k in PRECOMP_KEYS}
    for a in [equip['base_attr']] + list(equip.get('random_attrs', [])) + list(equip.get('single_attrs', [])):
        t = a['type']
        if t in p:
            p[t] += a['value']
    return p


def rolls_of(equip, attr_type):
    """成长次数 = 值 / (init*grate[quality-1])，见 INIT_GRATE"""
    init, grate = INIT_GRATE[attr_type]
    v = 0.0
    for a in list(equip.get('random_attrs', [])) + list(equip.get('single_attrs', [])):
        if a['type'] == attr_type:
            v += a['value']
    q = int(equip.get('quality', 6))
    return v / (init * grate[max(0, min(5, q - 1))])


def prune_score(equip, attr_types):
    """calculator @4994 te(): 有效属性的成长次数之和"""
    return sum(rolls_of(equip, t) for t in attr_types)


def equip_indicator(equip):
    """server-30aaffa2.js @471 s(): 前端根据 random_attrs 计算的御魂 indicator"""
    def g(t):
        for a in equip.get('random_attrs', []):
            if a['type'] == t:
                return a['value']
        return 0.0
    rnd = lambda x: int(round(x)) if not (isinstance(x, float) and math.isnan(x)) else x
    out = {}
    out['damage'] = rnd((g('Speed') / 2.7 + g('CritRate') * 100 / 2.7
                         + g('AttackRate') * 100 / 2.7 + g('CritPower') * 100 / 3.6) * 100 / 9)
    out['damageKq'] = rnd((g('Speed') / 2.7 + g('CritRate') * 100 / 2.7
                           + (g('AttackRate') + g('EffectHitRate')) * 100 / 2.7
                           + g('CritPower') * 100 / 3.6) * 100 / 9)
    out['damageJ0'] = rnd((g('Speed') / 2.7 + g('AttackRate') * 100 / 2.7
                           + g('CritPower') * 100 / 3.6) * 100 / 9)
    out['speed'] = rnd(g('Speed') / 2.7 * 100 / 6)
    out['bra'] = rnd((g('Speed') / 2.7 + g('CritRate') * 100 / 2.7
                      + g('HpRate') * 100 / 2.7 + g('CritPower') * 100 / 3.6) * 100 / 9)
    out['fxxk'] = rnd((g('Speed') / 2.7 + g('EffectHitRate') * 100 / 3.6) * 100 / 7)
    out['defenseBra'] = rnd((g('Speed') / 2.7 + g('CritRate') * 100 / 2.7
                             + g('DefenseRate') * 100 / 2.7 + g('CritPower') * 100 / 3.6) * 100 / 9)
    return out


# ============================================================================
# 3. 主线程：候选过滤 + 裁剪（calculator-4b0de9bb.js）
# ============================================================================

TARGETS = ['Damage', 'Defense', 'Hp', 'Attack', 'CritPower', 'Speed',
           'DefenseDamage', 'Healing', 'CritRate']

PRUNE_ATTRS = {  # calculator @32456 N()
    'CritPower': ['CritPower'],
    'Speed': ['Speed'],
    'Damage': ['AttackRate', 'CritRate', 'CritPower'],
    'Healing': ['HpRate', 'CritRate', 'CritPower'],
    'DefenseDamage': ['DefenseRate', 'CritRate', 'CritPower'],
    'Defense': ['DefenseRate'],
    'Attack': ['AttackRate'],
    'Hp': ['HpRate'],
}
# 注意 @30673 Pe() 里 case"Hp" 没有 break，会穿透到 case"CritPower"，
# 因此 Hp 目标的"类型套装"实际取 暴击伤害 类套装 —— 这是原实现的行为，原样保留。
TYPE_SUIT_ATTRS = {
    'Damage': ['暴击', '攻击加成'],
    'DefenseDamage': ['暴击', '防御加成'],
    'Healing': ['暴击', '生命加成'],
    'Defense': ['防御加成'],
    'Hp': ['暴击伤害'],
    'CritPower': ['暴击伤害'],
}


def target_attrs(hero, target):
    """calculator @32456 N()"""
    a = list(PRUNE_ATTRS.get(target, []))
    if target == 'Damage':
        if hero == '季':
            a = [x for x in a if x != 'CritRate']
        if hero == '孔雀明王':
            a.append('EffectHitRate')
    return a


def type_suit_ids(hero, target):
    """calculator @30673 Pe()"""
    if target == 'Damage' and hero == '孔雀明王':
        return suits_by_type(['暴击', '攻击加成', '效果命中'])
    return suits_by_type(TYPE_SUIT_ATTRS.get(target, []))


def filter_equips(equips, filters, extras):
    """calculator @19872 et()：6 星 15 级 + 排除 + 套装过滤 + 主属性过滤"""
    u = [e for e in equips if int(e.get('quality', 0)) == 6 and int(e.get('level', 0)) == 15]
    excludes = {str(x['id']) for x in (extras or {}).get('excludes', [])}
    if excludes:
        u = [e for e in u if str(e['id']) not in excludes]
    scs = filters.get('suitCombos') or []
    if sum(int(c['count']) for c in scs) == 6:
        allowed = set(expand_suit_ids([c['id'] for c in scs]))
        u = [e for e in u if int(e['suit_id']) in allowed]
    mal = filters.get('mainAttrsLimit') or {}
    if mal:
        out = []
        for e in u:
            p = int(e['pos']) + 1
            if p in mal and mal[p] and e['base_attr']['type'] not in mal[p]:
                continue
            out.append(e)
        u = out
    return u


def check_all_positions(equips):
    """calculator @20563 tt()：1-6 号位是否齐全"""
    have = {int(e['pos']) + 1 for e in equips}
    miss = [p for p in range(1, 7) if p not in have]
    return (len(miss) == 0), miss


def _split_by_suit(equips):
    b = {}
    for e in equips:
        b.setdefault(int(e['suit_id']), []).append(e)
    return b


def _split_by_pos(equips):
    b = {}
    for e in equips:
        b.setdefault(int(e['pos']), []).append(e)
    return b


def _keep_by_suit_pos(equips, score_attrs, n):
    """calculator @31811 G()：先按 suit_id 再按 pos 分组，各取 pruneScore 前 n"""
    out = []
    for sid, lst in _split_by_suit(equips).items():
        for pos, lst2 in _split_by_pos(lst).items():
            lst2 = sorted(lst2, key=lambda e: -prune_score(e, score_attrs))
            out.extend(lst2[:n])
    return out


def _keep_by_pos(equips, score_attrs, n):
    """calculator @32038 U()：按 pos 分组，取 pruneScore 前 n"""
    out = []
    for pos, lst in _split_by_pos(equips).items():
        lst = sorted(lst, key=lambda e: -prune_score(e, score_attrs))
        out.extend(lst[:n])
    return out


def _intersect_attrs(equip, attrs):
    attrs = set(attrs)
    for a in list(equip.get('random_attrs', [])) + list(equip.get('single_attrs', [])):
        if a['type'] in attrs:
            return True
    return False


def _categorize(equips, hero, target, filters, score_attrs):
    """calculator @30092 W()：knownSuit / typeSuit / usefulPve / otherPve / other"""
    known = {int(c['id']) for c in (filters.get('suitCombos') or []) if int(c['id']) > 100}
    tsuit = set(type_suit_ids(hero, target))
    o = {'knownSuit': [], 'typeSuit': [], 'usefulPve': [], 'otherPve': [], 'other': []}
    useful = {300052, 300077}  # 荒骷髅 / 鬼灵歌伎
    for e in equips:
        sid = int(e['suit_id'])
        if sid in known:
            o['knownSuit'].append(e)
        elif sid in tsuit:
            o['typeSuit'].append(e)
        elif is_leader_suit(sid):
            (o['usefulPve'] if sid in useful else o['otherPve']).append(e)
        else:
            o['other'].append(e)
    return o


def _lossless_prune(equips, hero, target, filters, score_attrs):
    """calculator @30888 ht()：无损裁剪"""
    o = _categorize(equips, hero, target, filters, score_attrs)
    for k in ('knownSuit', 'typeSuit', 'usefulPve', 'otherPve', 'other'):
        o[k] = _keep_by_suit_pos_or_attrs(o[k], score_attrs) if k in ('knownSuit', 'typeSuit', 'usefulPve') \
            else _keep_by_pos_attrs(o[k], score_attrs)
    return _flatten(o)


def _keep_by_suit_pos_or_attrs(equips, attrs):
    """calculator @31108 K()：每个 (suit,pos) 保留命中 attrs 的，若一个都没有则留 1 个"""
    out = []
    for sid, lst in _split_by_suit(equips).items():
        for pos, lst2 in _split_by_pos(lst).items():
            hit = [e for e in lst2 if _intersect_attrs(e, attrs)]
            out.extend(hit if hit else lst2[:1])
    return out


def _keep_by_pos_attrs(equips, attrs):
    """calculator @31576 he()：按 pos 保留命中 attrs 的"""
    out = []
    for pos, lst in _split_by_pos(equips).items():
        out.extend([e for e in lst if _intersect_attrs(e, attrs)])
    return out


def _flatten(o):
    return (o['knownSuit'] + o['typeSuit'] + o['usefulPve'] + o['otherPve'] + o['other'])


def _merge(o):
    return {'knownSuit': o['knownSuit'], 'typeSuit': o['typeSuit'], 'usefulPve': o['usefulPve'],
            'otherPve': o['otherPve'], 'other': o['other']}


def _lossy_lv0(equips, hero, target, filters, extras):
    """calculator @27335 lt()：有损裁剪 Lv0（按目标属性裁剪）"""
    if target not in ('CritPower', 'Speed', 'Defense', 'Hp', 'Attack'):
        return equips
    fast = bool(extras.get('fastMode'))
    score_attrs = target_attrs(hero, target)
    o = _categorize(equips, hero, target, filters, score_attrs)
    r = target != 'Speed'
    f = c = 1
    if filters.get('propsLimit'):
        f = 3 if fast else 5
        c = 5 if fast else 8
    if r:
        f = 3 if fast else 5
        c = 2 if fast else 3
    o['knownSuit'] = _keep_by_suit_pos(o['knownSuit'], score_attrs, f)
    if r:
        o['typeSuit'] = _keep_by_suit_pos(o['typeSuit'], score_attrs, 2 if fast else 3)
        y = _keep_by_pos(o['usefulPve'] + o['otherPve'] + o['other'], score_attrs, c)
        return o['knownSuit'] + o['typeSuit'] + y
    d = _keep_by_pos(o['typeSuit'] + o['usefulPve'] + o['otherPve'] + o['other'], score_attrs, c)
    return o['knownSuit'] + d


def _lossy_lv1(equips, hero, target, filters, extras):
    """calculator @28115 dt()：有损裁剪 Lv1（无 6 件套约束时）"""
    fast = bool(extras.get('fastMode'))
    attrs = target_attrs(hero, target)
    if target not in ('CritPower', 'Defense'):
        attrs = list(dict.fromkeys(attrs + list((filters.get('propsLimit') or {}).keys())))
    o = _categorize(equips, hero, target, filters, attrs)
    o['typeSuit'] = _keep_by_suit_pos(o['typeSuit'], attrs, 2 if fast else 4)
    o['usefulPve'] = _keep_by_suit_pos(o['usefulPve'], attrs, 3 if fast else 5)
    o['otherPve'] = _keep_by_pos(o['otherPve'], attrs, 5 if fast else 15)
    o['other'] = _keep_by_pos(o['other'], attrs, 5 if fast else 15)
    return _flatten(o)


def _lossy_lv2(equips, hero, target, filters, extras):
    """calculator @29209 Rt()：有损裁剪 Lv2（每个 (suit,pos) 收敛到固定名额）"""
    fast = bool(extras.get('fastMode'))
    attrs = target_attrs(hero, target)
    if target not in ('CritPower', 'Defense'):
        attrs = list(dict.fromkeys(attrs + list((filters.get('propsLimit') or {}).keys())))
    o = _categorize(equips, hero, target, filters, attrs)
    n = 10
    if len([v for v in (filters.get('propsLimit') or {}).values() if v]) == 1:
        n = 16
    if not fast:
        n = 30
    if sum(int(c['count']) for c in (filters.get('suitCombos') or []) if int(c['id']) > 100) < 6:
        n = 10 if fast else 20
    out = []
    for sid, lst in _split_by_suit(o['knownSuit']).items():
        for pos, lst2 in _split_by_pos(lst).items():
            lst2 = sorted(lst2, key=lambda e: -prune_score(e, attrs))
            thr = 7 if suit_type(sid) == '首领御魂' else 5
            keep = [e for e in lst2 if math.ceil(prune_score(e, attrs)) >= thr][:n]
            if len(keep) <= 5:
                keep = lst2[:5]
            out.extend(keep)
    o['knownSuit'] = out
    return _flatten(o)


def prune(equips, hero, target, filters, extras):
    """calculator @20678 nt()：pruneOfLossless → Lv0 → (Lv1) → Lv2"""
    score_attrs = target_attrs(hero, target)
    pl = []
    for k, v in (filters.get('propsLimit') or {}).items():
        if v and (v.get('min') is not None or v.get('max') is not None):
            pl.append(k)
    has = [e for e in equips if _intersect_attrs(e, pl)]
    non = [e for e in equips if not _intersect_attrs(e, pl)]
    eq = has + _lossless_prune(non, hero, target, filters, score_attrs) if pl else equips
    eq = _lossy_lv0(eq, hero, target, filters, extras)
    if sum(int(c['count']) for c in (filters.get('suitCombos') or []) if int(c['id']) > 100) < 6:
        eq = _lossy_lv1(eq, hero, target, filters, extras)
    return _lossy_lv2(eq, hero, target, filters, extras)


# ============================================================================
# 4. 组合生成（calculator @25151 ct() / @26496 ft() / @19848 it()）
# ============================================================================

def _permutations_unique(arr):
    """calculator @26496 ft()：多重集去重全排列"""
    out = []
    seen = set()
    for p in permutations(arr):
        if p not in seen:
            seen.add(p)
            out.append(list(p))
    return out


def gen_suit_combos(equips, hero, target, filters):
    """calculator @25151 ct()：生成"每号位套装 id"的组合，再做全排列"""
    by_pos = _split_by_pos(equips)
    scs = filters.get('suitCombos') or []
    r = []
    if not scs:
        if target in ('Defense', 'CritPower', 'Speed'):
            pos_suits = {}
            for pos, lst in by_pos.items():
                pos_suits[pos] = list(dict.fromkeys(int(e['suit_id']) for e in lst))
            for combo in _product6(pos_suits):
                r.append(list(combo))
        else:
            return []
    else:
        present = set()
        for lst in by_pos.values():
            for e in lst:
                present.add(int(e['suit_id']))
        four = next((c for c in scs if int(c['count']) == 4), None)
        two = next((c for c in scs if int(c['count']) == 2), None)
        if not four:
            return []
        c = int(four['id'])
        if two:
            for l in expand_suit_ids([two['id']]):
                if l in present:
                    r.append([c, c, c, c, l, l])
        else:
            tsuit = type_suit_ids(hero, target)
            for p in tsuit:
                if p in present:
                    r.append([c, c, c, c, p, p])
            if tsuit:
                leaders = [sid for sid in SUITS if suit_type(sid) == '首领御魂' and sid in present]
                normals = [sid for sid in SUITS if suit_type(sid) != '首领御魂' and sid in present]
                for i in range(len(leaders)):
                    for j in range(i, len(leaders)):
                        r.append([c, c, c, c, leaders[i], leaders[j]])
                for a in leaders:
                    for b in normals:
                        r.append([c, c, c, c, a, b])
            else:
                allp = [sid for sid in SUITS if sid in present]
                for i in range(len(allp)):
                    for j in range(i, len(allp)):
                        r.append([c, c, c, c, allp[i], allp[j]])
    out = []
    for arr in r:
        out.extend(_permutations_unique(arr))
    return out


def _product6(pos_suits):
    """6 号位的套装 id 笛卡尔积（对应 calculator 的 lodash product）"""
    keys = sorted(pos_suits.keys())[:6]
    if len(keys) < 6:
        return []
    res = [[]]
    for k in keys:
        res = [x + [s] for x in res for s in pos_suits[k]]
    return res


def gen_equip_combos(suit_combos, equips):
    """calculator @19848 it()：把"套装 id 组合"展开成"该位置该套装的御魂候选列表" """
    by_pos = _split_by_pos(equips)
    idx = {}
    for pos, lst in by_pos.items():
        d = {}
        for e in lst:
            d.setdefault(int(e['suit_id']), []).append(e)
        idx[pos] = d
    out = []
    for sc in suit_combos:
        arrays = [idx.get(i, {}).get(int(sc[i]), []) for i in range(6)]
        if all(a for a in arrays):
            out.append(arrays)
    return out


def product_equips(arrays):
    """worker Xa()：6 个候选列表的笛卡尔积（每个结果 = 6 件御魂）"""
    res = [[]]
    for a in arrays:
        res = [x + [e] for x in res for e in a]
    return res


# ============================================================================
# 5. Worker 数值计算（assets_calculatorWorker-27a82e97.js）
# ============================================================================

def f_attack(F, Y, ep=None, effects=None):
    """worker @98895 Fn()：面板攻击
    ep = extraProps(字典: Attack/AttackRate/Defense/CritPower)；
    effects = extras 列表([{type,value}])，仅用于"天照.天晖.减"/"回合外"判定"""
    ep = ep or {}
    effects = effects or []
    H = F.get('AttackRate', 0) + ep.get('AttackRate', 0)
    if Y.get('name') == '孔雀明王':
        H += F.get('EffectHitRate', 0) + ep.get('EffectHitRate', 0)
    R = Y['Attack'] * (1 + H) + F.get('Attack', 0) + ep.get('Attack', 0)
    if Y.get('name') == '云外镜':
        R += 2 * f_defense(F, Y, ep)
    P = R
    utb = F.get('_unknownTeamBonus')
    if utb:
        if utb.get('不见岳防御'):
            P += min(utb['不见岳防御'] * .5, R * .2)
            if not any(x['type'] == '回合外' for x in effects):
                P += min(utb['不见岳防御'] * 2, R * .4)
        if utb.get('麓魂') == 'Y' and not any(x['type'] == '回合外' for x in effects):
            P *= 1 + min(.55, 0 + .595)
    if any(x['type'] == '天照.天晖.减' for x in effects):
        P *= 1 - .15
    return P


def f_defense(F, Y, ep=None):
    """worker @100111 Br()：面板防御"""
    ep = ep or {}
    return Y['Defense'] * (1 + F.get('DefenseRate', 0) + ep.get('DefenseRate', 0)) \
        + F.get('Defense', 0) + ep.get('Defense', 0)


def f_hp(F, Y, ep=None):
    """worker @100674 Wr()：面板生命（桃花妖 +10%）"""
    ep = ep or {}
    c = F.get('HpRate', 0) + ep.get('HpRate', 0)
    if Y.get('name') == '桃花妖':
        c += .1
    return Y['Hp'] * (1 + c) + F.get('Hp', 0) + ep.get('Hp', 0)


def f_critpower(F, Y, ep=None):
    """worker @100478 wo()：面板暴击伤害"""
    ep = ep or {}
    return Y['CritPower'] + F.get('CritPower', 0) + ep.get('CritPower', 0)


def f_speed(F, Y):
    """worker @100481 Co()：面板速度 = 式神基础 + 御魂速度（不含 extraProps，原实现如此）"""
    return Y['Speed'] + F.get('Speed', 0)


def simple_damage(attack_panel, F, Y, ep=None):
    """worker @99289 vo()：简单模式伤害 = 面板攻击 × 面板暴伤
    季特例：attack*(套装+额外暴伤)，不含基础暴伤"""
    y = F.get('CritPower', 0) + (ep or {}).get('CritPower', 0)
    if Y.get('name') == '季':
        return attack_panel * y
    return attack_panel * (Y['CritPower'] + y)


def complex_damage(attack_panel, F, Y, ep, effects, is_pve, msg, combos):
    """worker @99533 Ro()：复杂模式（含歌姬/荒骷髅/天照追击/减伤因子预计算）"""
    hero = Y.get('name')
    cp = Y['CritPower'] + F.get('CritPower', 0) + (ep or {}).get('CritPower', 0)
    if hero == '季':
        cp -= .5
    gj = ''
    if is_pve:
        if sum(1 for e in combos if int(e['suit_id']) == 300052) >= 2:
            gj = '荒骷髅'
        elif sum(1 for e in combos if int(e['suit_id']) == 300077) >= 2:
            gj = '鬼灵歌伎'
    injury_factor = msg.get('injuryFactor', 0)
    bearing = msg.get('bearingRatio', 1)
    gj_factor = msg.get('gjYuhunFactor', 1)
    if hero == '季':
        z = attack_panel * cp * injury_factor
    else:
        z = attack_panel * cp * injury_factor * bearing
    i = 0.0
    if gj == '荒骷髅':
        z *= 1.1
    elif gj == '鬼灵歌伎':
        i = attack_panel * gj_factor * 2.55
    if hero == '天照' and msg.get('copyOfExtraProps'):
        c2 = msg['copyOfExtraProps']
        atk2 = f_attack(F, Y, c2, msg.get('copyEffects'))
        cp2 = Y['CritPower'] + c2.get('CritPower', 0)
        q = atk2 * cp2 * msg.get('copyOfInjuryFactor', 1) * bearing
        if gj == '荒骷髅':
            q *= 1.1
        elif gj == '鬼灵歌伎':
            q += atk2 * gj_factor * 2.55
        z += q
    return z + i


def worker_value(msg, combos):
    """worker onmessage 主体：给定 6 件御魂与消息体，返回 (value, F)"""
    hero = msg['hero']
    target = msg['target']
    ep = msg.get('extraProps') or {}       # worker 的 x：额外属性字典
    effects = msg.get('extras') or []      # worker 的 I：效果列表 [{type,value}]
    Y = hero_base(hero)
    gain = msg.get('knownSuitGain') or {}
    if msg.get('haveUnknownSuit'):
        gain = {}
        seen = set()
        for e in combos:
            sid = int(e['suit_id'])
            cnt = sum(1 for x in combos if int(x['suit_id']) == sid)
            if cnt >= 2 and sid not in seen:
                seen.add(sid)
                for k, v in TWO_PIECE_BY_TYPE.get(suit_type(sid), {}).items():
                    gain[k] = gain.get(k, 0) + v
    F = {}
    pre = msg.get('preComputedPropsLimit') or {}

    if target in ('Damage', 'DefenseDamage', 'Healing', 'CritRate') or 'CritRate' in pre:
        F['CritRate'] = sum(e['_p']['CritRate'] for e in combos) + gain.get('CritRate', 0)
    if target in ('Damage', 'Attack') or 'Attack' in pre:
        F['Attack'] = sum(e['_p']['Attack'] for e in combos)
        F['AttackRate'] = sum(e['_p']['AttackRate'] for e in combos) + gain.get('AttackRate', 0)
    if target == 'Speed' or 'Speed' in pre:
        F['Speed'] = sum(e['_p']['Speed'] for e in combos)
    if target in ('Damage', 'DefenseDamage', 'Healing', 'CritPower') or 'CritPower' in pre:
        F['CritPower'] = sum(e['_p']['CritPower'] for e in combos) + gain.get('CritPower', 0)
    if hero == '云外镜' or target in ('Defense', 'DefenseDamage') or 'Defense' in pre:
        F['Defense'] = sum(e['_p']['Defense'] for e in combos)
        F['DefenseRate'] = sum(e['_p']['DefenseRate'] for e in combos) + gain.get('DefenseRate', 0)
    if target in ('Hp', 'Healing') or 'Hp' in pre:
        F['Hp'] = sum(e['_p']['Hp'] for e in combos)
        F['HpRate'] = sum(e['_p']['HpRate'] for e in combos) + gain.get('HpRate', 0)
    if hero == '孔雀明王':
        F['EffectHitRate'] = sum(e['_p']['EffectHitRate'] for e in combos) + gain.get('EffectHitRate', 0)
    F['_unknownTeamBonus'] = msg.get('unknownTeamBonus') or {}

    # 属性限制（worker @96952）：CritRate/CritPower/Speed 比较御魂面板，Attack/Defense/Hp 比较总面板
    if pre:
        if 'CritRate' in pre:
            lo, hi = pre['CritRate'].get('min'), pre['CritRate'].get('max')
            if (lo is not None and F.get('CritRate', 0) < lo) or (hi is not None and F.get('CritRate', 0) > hi):
                return None, F
        if 'Speed' in pre:
            sp = sum(e['_p']['Speed'] for e in combos)
            lo, hi = pre['Speed'].get('min'), pre['Speed'].get('max')
            if (lo is not None and sp < lo) or (hi is not None and sp > hi):
                return None, F
        if 'CritPower' in pre:
            lo, hi = pre['CritPower'].get('min'), pre['CritPower'].get('max')
            if (lo is not None and F.get('CritPower', 0) < lo) or (hi is not None and F.get('CritPower', 0) > hi):
                return None, F
        if 'Attack' in pre:
            v = f_attack(F, Y, ep, effects)
            lo, hi = pre['Attack'].get('min'), pre['Attack'].get('max')
            if (lo is not None and v < lo) or (hi is not None and v > hi):
                return None, F
        if 'Defense' in pre:
            v = f_defense(F, Y, ep)
            lo, hi = pre['Defense'].get('min'), pre['Defense'].get('max')
            if (lo is not None and v < lo) or (hi is not None and v > hi):
                return None, F
        if 'Hp' in pre:
            v = f_hp(F, Y, ep)
            lo, hi = pre['Hp'].get('min'), pre['Hp'].get('max')
            if (lo is not None and v < lo) or (hi is not None and v > hi):
                return None, F

    if target == 'Damage':
        atk = f_attack(F, Y, ep, effects)
        if msg.get('complexMode'):
            v = complex_damage(atk, F, Y, ep, effects, msg.get('isPve'), msg, combos)
        else:
            v = simple_damage(atk, F, Y, ep)
        if msg.get('isPve') and hero != '空相面灵气' and \
                sum(1 for e in combos if int(e['suit_id']) == 300052) >= 2:
            v *= 1.1
    elif target == 'Defense':
        v = f_defense(F, Y, ep)
    elif target == 'Hp':
        v = f_hp(F, Y, ep)
    elif target == 'Attack':
        v = f_attack(F, Y, ep, effects)
    elif target == 'CritPower':
        v = f_critpower(F, Y, ep)
    elif target == 'Speed':
        v = f_speed(F, Y)
    elif target == 'DefenseDamage':
        v = f_defense(F, Y, ep) * f_critpower(F, Y, ep)
    elif target == 'Healing':
        v = f_hp(F, Y, ep) * f_critpower(F, Y, ep)
    else:
        v = None
    return v, F


# ============================================================================
# 6. 主线程 Pt()：完整"计算一个指标"的流水线
# ============================================================================

def pre_compute_props_limit(hero, props_limit):
    """calculator @24478 ot()：把用户填的"面板限制"换算成"御魂加成限制" """
    if not props_limit:
        return {}
    base = hero_base(hero)
    out = {}
    for k, v in props_limit.items():
        v = dict(v)
        if k == 'CritRate':
            v['min'] = (v['min'] / 100 - base['CritRate']) if v.get('min') is not None else None
            v['max'] = (v['max'] / 100 - base['CritRate']) if v.get('max') is not None else None
        elif k in ('Speed', 'CritPower'):
            v['min'] = (v['min'] - base[k]) if v.get('min') is not None else None
            v['max'] = (v['max'] - base[k]) if v.get('max') is not None else None
        elif k in ('Attack', 'Defense', 'Hp'):
            pass
        else:
            raise ValueError('不支持的限制条件: ' + k)
        out[k] = v
    return out


def build_message(combos, hero, target, filters, settings):
    """calculator @22268 st()：组装发给 worker 的消息（每个 worker 只换 yuhunComboChunk）"""
    settings = settings or {}
    extras = settings.get('extras') or []          # injuryExtras
    team = settings.get('team') or []
    team_values = settings.get('teamValues') or {}
    boss = settings.get('boss') or {}
    is_pve = settings.get('isPve')
    fast = bool(settings.get('fastMode'))

    pl = pre_compute_props_limit(hero, filters.get('propsLimit'))
    known = suit_combo_gain(filters.get('suitCombos') or [])
    have_unknown = sum(int(c['count']) for c in (filters.get('suitCombos') or []) if int(c['id']) > 100) < 6
    base = hero_base(hero)
    extra_props = {'Attack': attack_extra_from_extras(hero, extras),
                   'CritPower': critpower_extra_from_extras(hero, team_values, extras),
                   'Defense': defense_extra_from_extras(team_values, extras)}
    if isinstance(team, dict) and team.get('extraProps'):
        for k, v in team['extraProps'].items():
            extra_props[k] = extra_props.get(k, 0) + v
    msg = {
        'hero': hero, 'target': target, 'knownSuitGain': known,
        'haveUnknownSuit': have_unknown, 'preComputedPropsLimit': pl,
        'unknownTeamBonus': {}, 'isPve': is_pve, 'extraProps': extra_props,
        'extras': extras, 'complexMode': False,
    }
    if team:
        if any(h.get('hero') == '龙吟铃鹿御前' for h in team):
            msg['unknownTeamBonus']['麓魂'] = 'Y'
        if team_values.get('不见岳'):
            msg['unknownTeamBonus']['不见岳防御'] = team_values['不见岳']['panel']['Defense']

    # 复杂模式判定：PVE + 歌姬 / 天照追击 / 显式复杂模式
    complex_mode = bool(is_pve and has_suit(filters.get('suitCombos'), '鬼灵歌伎'))
    if hero == '天照' and team:
        for h in team:
            if h.get('ccExtras'):
                try:
                    if any(x['type'] == '天照.天晖.追击' for x in h['ccExtras']([], h, team, team_values)):
                        complex_mode = True
                except TypeError:
                    pass
    if hero == '空相面灵气' or any(x['type'] == '指标计算简单化' for x in extras):
        complex_mode = False
    msg['complexMode'] = complex_mode
    if complex_mode:
        names = [suit_name(c['id']) for c in (filters.get('suitCombos') or [])]
        msg['injuryFactor'] = injury_factor(hero, names, extras)
        msg['bearingRatio'] = bearing_ratio(hero, boss.get('Defense') or 0, extras)
        msg['gjYuhunFactor'] = suit_factor(names, 0, extras)
        if hero == '天照' and team:
            for h in team:
                if h.get('ccExtras') and any(x['type'] == '天照.天晖.追击' for x in h['ccExtras']([], h, team, team_values)):
                    oe = [{'type': '回合外'}, {'type': '天照.天晖.追击.减伤'}]
                    msg['copyOfExtraProps'] = {'Attack': attack_extra_from_extras(hero, extras),
                                               'CritPower': critpower_extra_from_extras(hero, team_values, oe)}
                    msg['copyOfInjuryFactor'] = 1.0
                    msg['copyEffects'] = oe
    return msg


def has_suit(suit_combos, name):
    for c in suit_combos or []:
        if suit_name(c['id']) == name:
            return True
    return False


EXTRA_CAP = 3   # Python 侧额外裁剪：每个 (套装,号位) 只保留 pruneScore 前 N 件。
# 前端 fastMode 本身也会做有损裁剪；此处追加一道仅为把 Python 运行时间压到可接受范围。
# 设为 0 可关闭（--exact），此时 4+2 套装的组合量约 1e6~1e7，会跑很久。


def _extra_prune(equips, hero, target, cap):
    if not cap:
        return equips
    attrs = target_attrs(hero, target)
    out = []
    for sid, lst in _split_by_suit(equips).items():
        for pos, lst2 in _split_by_pos(lst).items():
            lst2 = sorted(lst2, key=lambda e: -prune_score(e, attrs))
            out.extend(lst2[:cap])
    return out


def pt(equips, hero, target, filters, settings=None):
    """主线程 Pt()（calculator @19313）的同步复刻。返回 top6 结果列表。"""
    t0 = time.time()
    settings = dict(settings or {})
    extras = settings.get('extras') or []
    tgt = target['value'] if isinstance(target, dict) else target
    tmin = target.get('min') if isinstance(target, dict) else None
    target = tgt
    equips = filter_equips(equips, filters, settings)
    ok, miss = check_all_positions(equips)
    if not ok:
        raise ValueError('号位御魂数据缺失: %s' % miss)
    pruned = prune(equips, hero, target, filters, settings)
    pruned = _extra_prune(pruned, hero, target, EXTRA_CAP)
    for e in pruned:
        e['_p'] = precompute(e)
    suit_combos = gen_suit_combos(pruned, hero, target, filters)
    equip_groups = gen_equip_combos(suit_combos, pruned)
    msg = build_message(equip_groups, hero, target, filters, settings)
    sort_dir = (target.get('sort') if isinstance(target, dict) else None) or filters.get('sort')
    asc = (sort_dir == 'asc')
    best = []  # 维护 top100
    n_eval = 0
    seq = 0
    for arrays in equip_groups:
        for combo in product_equips(arrays):
            n_eval += 1
            v, F = worker_value(msg, combo)
            if v is None:
                continue
            if tmin is not None and v < tmin:
                continue
            item = {'value': v, 'suit': combo, 'yuhunGain': F}
            seq += 1
            heapq.heappush(best, ((-v) if asc else v, seq, item))
            if len(best) > 100:
                heapq.heappop(best)
    top = [x[2] for x in heapq.nlargest(len(best), best, key=lambda z: z[0])]
    top.sort(key=lambda r: r['value'], reverse=not asc)
    # 计算 yuhunGain（calculator @24223 Ue）
    for r in top:
        allp = [precompute(e) for e in r['suit']]
        r['yuhunGain'] = aggregate_gain(allp, r['suit'])
    if filters.get('x2nd'):
        x = filters['x2nd']
        key = {'Speed': 'Speed', 'CritRate': 'CritRate', 'CritPower': 'CritPower'}[x['value']]
        top.sort(key=lambda r: r['yuhunGain'].get(key, 0), reverse=(x.get('sort') != 'asc'))
    top = top[:6]
    for r in top:
        r['_elapsed'] = time.time() - t0
        r['_nEval'] = n_eval
    return top


def aggregate_gain(precomps, combo):
    """calculator @3226 Ue()：套装 2 件套 + 6 件御魂属性汇总"""
    gain = {}
    for p in precomps:
        for k, v in p.items():
            gain[k] = gain.get(k, 0) + v
    counts = {}
    for e in combo:
        sid = int(e['suit_id'])
        counts[sid] = counts.get(sid, 0) + 1
    for sid, cnt in counts.items():
        if cnt >= 2:
            for k, v in TWO_PIECE_BY_TYPE.get(suit_type(sid), {}).items():
                gain[k] = gain.get(k, 0) + v
    return gain


# ============================================================================
# 7. 伤害/减伤/技能系数（复杂模式与 PVE/一键共用）
# ============================================================================

def hit_count(hero, extras):
    """calculator @16492 Z()"""
    for x in extras or []:
        if x['type'] == '攻击段数':
            return int(x['value'])
    return HIT_COUNT.get(hero, 1)


def skill_coef(hero, hit_idx, extras):
    """calculator @16923 x()：单段技能系数"""
    lv = 5
    for x in extras or []:
        if x['type'] == '技能等级':
            lv = int(x['value'])
    if hero == '天照':
        i = 1.0
    elif hero == '须佐之男':
        i = 1.0
    elif hero == '玉藻前':
        i = {1: 1.31, 2: 1.38, 3: 1.587, 4: 1.6675, 5: 1.6675}[max(1, min(5, lv))]
    elif hero == '般若':
        i = 1.3
    elif hero == '云外镜':
        i = 1.45
    elif hero == '阿修罗':
        reason = 6
        for x in extras or []:
            if x['type'] == '理性数量':
                reason = x['value']
        i = 3.465 * (1 - reason * .06)
    elif hero == '秘术·豹袭':
        i = 1.4 + .4 * lv
    elif hero == '季':
        i = 1.2 if any(x['type'] == '季·四时一隅·秋' for x in extras or []) else .4
    elif hero == '本真三尾狐':
        i = 1.68
    else:
        i = 1.0
    for x in extras or []:
        if x['type'] == '技能伤害系数':
            i *= x['value']
    r = 1.0
    if hit_idx == 0:
        r += sum(x['value'] for x in (extras or []) if x['type'] == '首段独立增伤')
    return i * r


def star_bonus(hero, extras):
    """calculator @16699 V()：须佐之男 ×2 + 星类增伤"""
    e = 1.0
    if hero == '须佐之男':
        e += 1
    for x in extras or []:
        if x['type'] == '星类增伤':
            e += x['value']
    return e


def bearing_ratio(hero, defense, extras):
    """calculator @14560 ne()：防御减伤比 300/(300+防御)"""
    d = defense
    if hero == '玉藻前':
        d -= 100
    for x in extras or []:
        if x['type'] == '防御减少':
            d -= x['value']
    d = max(0, d)
    r = 300 / (300 + d)
    for x in extras or []:
        if x['type'] == '减伤比例':
            r *= 1 - x['value']
    return r


def suit_factor(suit_names, hit_idx, extras):
    """calculator @16048 ue()：御魂套装增伤系数
    海月火玉/破势 +40%；心眼 +10%*floor((1-血量比)/15%)；狂骨 +8%*鬼火；隐念 20/40/60%；
    荒骷髅 ×1.1"""
    u = 1.0
    if '海月火玉' in suit_names or '破势' in suit_names:
        u += .4
    elif '心眼' in suit_names:
        hp = 1.0
        for x in extras or []:
            if x['type'] == 'remainingHpRatio':
                hp = x['value']
        u += .1 * math.floor((1 - max(hp, 0)) / .15)
    elif '狂骨' in suit_names:
        fire = 0
        for x in extras or []:
            if x['type'] == 'nOfGlint':
                fire = x['value']
        u += .08 * fire
    elif '隐念' in suit_names:
        u += [.2, .4, .6][hit_idx % 3]
    if '荒骷髅' in suit_names:
        u *= 1.1
    return u


def injury_factor(hero, suit_names, extras):
    """calculator @16492 Se()/He()：整回合增伤因子 = Σ(技能系数×套装系数) × 星类增伤"""
    s = 0.0
    for i in range(hit_count(hero, extras)):
        s += skill_coef(hero, i, extras) * suit_factor(suit_names, i, extras)
    return s * star_bonus(hero, extras)


def gj_damage(hero, hit_idx, attack, critpower, extras):
    """calculator @14328 le()：鬼灵歌伎额外伤害"""
    if any(x['type'] == '不触发歌姬' for x in extras or []):
        return 0.0
    times = 1
    for x in extras or []:
        if x['type'] == '触发多次歌姬':
            times = x['value'] or 1
    r = suit_factor([], hit_idx, extras)
    if hero == '季':
        r *= critpower - .5
    limit = 1e7
    for x in extras or []:
        if x['type'] == '单段最大伤害限制':
            limit = x['value']
    return min(attack * r * 2.55, limit) * times


def attack_extra_from_extras(hero, extras):
    """calculator @14900 X()：额外攻击（基础攻击加成类）"""
    s = 0.0
    u = 0.0
    for x in extras or []:
        if x['type'] == '基础攻击加成':
            u += x['value']
    s += hero_base(hero)['Attack'] * u
    return s


def attack_extra_total(hero_info, team, team_values, extras):
    """calculator @14797 Xe()：面板攻击的额外部分（云外镜/不见岳/初始攻击减少/麓魂）"""
    hero = hero_info['hero']
    s = attack_extra_from_extras(hero, extras)
    i = hero_info['panel']['Attack']
    if hero == '云外镜':
        o = hero_info['panel']['Defense'] * 2
        i += o
        s += o
    if team_values.get('不见岳'):
        s += min(team_values['不见岳']['panel']['Defense'] * .5, i * .2)
        if not any(x['type'] == '回合外' for x in extras or []):
            s += min(team_values['不见岳']['panel']['Defense'] * 2, i * .4)
    r = 0.0
    for x in extras or []:
        if x['type'] == '初始攻击减少':
            r -= x['value']
    if team and any(h.get('hero') == '龙吟铃鹿御前' for h in team):
        if not any(x['type'] == '回合外' for x in extras or []):
            r = min(.55, r + .595)
    s += i * r
    return s


def critpower_extra_from_extras(hero, team_values, extras):
    """calculator @15495 J()/Je()：因幡辉夜姬暴伤加成 + 暴伤提升 + 镇墓兽"""
    e = 0.0
    if not any(x['type'] == '未出手' for x in extras or []):
        if team_values.get('因幡辉夜姬'):
            gold = 0
            for x in extras or []:
                if x['type'] == 'nOfGoldMoon':
                    gold = x['value']
            e += min((team_values['因幡辉夜姬']['panel']['CritPower'] + gold * .05) * .3, 1.2)
    for x in extras or []:
        if x['type'] == '暴伤提升':
            e += x['value']
    return e


def defense_extra_from_extras(team_values, extras):
    """calculator @15829 Qe()：不见岳防御转攻击（防御输出用）"""
    e = 0.0
    if not any(x['type'] == '未出手' for x in extras or []):
        if team_values.get('不见岳'):
            e += min(team_values['不见岳']['panel']['Defense'] * .3, 200)
    return e


def injury(hero_info, team, team_values, boss, strict, extras, suit_names=None):
    """calculator @13385 wt()：单式神对 Boss 的伤害（复杂模式，PVE/一键核心）"""
    hero = hero_info['hero']
    suit_names = suit_names if suit_names is not None else [suit_name(e['suit_id']) for e in hero_info.get('suit', [])]
    f = hero_info['panel']['Attack'] + attack_extra_total(hero_info, team, team_values, extras)
    c = hero_info['panel']['CritPower'] + critpower_extra_from_extras(hero, team_values, extras)
    d = star_bonus(hero, extras)
    y = bearing_ratio(hero, (boss or {}).get('Defense') or 0, extras)
    l = .99 if strict else 1.0
    p = 0.0
    k = 0.0
    for m in range(hit_count(hero, extras)):
        w = skill_coef(hero, m, extras)
        h = suit_factor(suit_names, m, extras)
        if hero == '季':
            e = f * (c - .5) * w * h * d
        elif hero_info['panel']['CritRate'] > .99:
            e = f * c * w * h * d * y * l
        else:
            e = f * w * h * d * y * l
        p += e
        if '鬼灵歌伎' in suit_names and (m % 6 == 5 or any(x['type'] == '触发歌姬' for x in extras or [])):
            k += gj_damage(hero, m + 1, f, c, extras)
    res = {'injury': p}
    if k > 0:
        res['injury'] = p + k
        res['directInjury'] = p
        res['gjInjury'] = k
    if any(x['type'] == '天照.天晖.追击' for x in extras or []):
        m = team_values.get('天照')
        if m:
            w = [{'type': '回合外'}, {'type': '天照.天晖.追击.减伤'}] + \
                [x for x in extras if x.get('marks') == 'team'] + \
                [x for x in extras if x['type'] == '天照.天晖.追击'][0]['value']
            hh = m['panel']['Attack'] + attack_extra_total(m, team, team_values, w)
            cc = m['panel']['CritPower'] + critpower_extra_from_extras('天照', team_values, w)
            v = star_bonus(hero, w)
            a = 0.0
            dgj = 0.0
            for i in range(hit_count('天照', w)):
                coef = skill_coef('天照', i, w)
                sf = suit_factor([suit_name(e['suit_id']) for e in m.get('suit', [])], i, w)
                a += hh * cc * coef * sf * v * y * l
            res['injury'] += a
            res['copyOfDirectInjury'] = a
    return res


# ============================================================================
# 8. teamBase：面板 / 指标换算 / 固定挂件
# ============================================================================

def panel_from_equips(hero, equip_list, extra_props=None):
    """teamBase @0 C() 传"6 件御魂"时的版本：k(c)=Ue(equips) 汇总 6 件御魂属性 + 2 件套"""
    gain = aggregate_gain([precompute(e) for e in equip_list], equip_list)
    return _panel_from_gain(hero, gain, extra_props)


def team_panel(hero, suit_combos, extra_props=None):
    """chunks/assets_teamBase-e0e42ee9.js @0 C()：面板 = 基础 + 御魂加成 + 额外属性
    （当只有套装信息、没有具体御魂时，退化为只算套装 2 件套）"""
    return _panel_from_gain(hero, suit_combo_gain(suit_combos), extra_props)


def _panel_from_gain(hero, gain, extra_props=None):
    t = hero_base(hero)
    if extra_props:
        gain = dict(gain)
        for k, v in extra_props.items():
            gain[k] = gain.get(k, 0) + v
    yuhun_panel = {
        'Attack': t['Attack'] * gain.get('AttackRate', 0) + gain.get('Attack', 0),
        'Hp': t['Hp'] * gain.get('HpRate', 0) + gain.get('Hp', 0),
        'Defense': t['Defense'] * gain.get('DefenseRate', 0) + gain.get('Defense', 0),
        'Speed': gain.get('Speed', 0),
        'CritRate': gain.get('CritRate', 0),
        'CritPower': gain.get('CritPower', 0),
        'EffectHitRate': gain.get('EffectHitRate', 0),
        'EffectResistRate': gain.get('EffectResistRate', 0),
    }
    hp_rate = 1 + gain.get('HpRate', 0)
    if hero == '桃花妖':
        hp_rate += .1
    final = {
        'Attack': t['Attack'] * (1 + gain.get('AttackRate', 0) + (extra_props or {}).get('AttackRate', 0))
                  + gain.get('Attack', 0) + (extra_props or {}).get('Attack', 0),
        'Hp': t['Hp'] * hp_rate + gain.get('Hp', 0),
        'Defense': t['Defense'] * (1 + gain.get('DefenseRate', 0)) + gain.get('Defense', 0)
                   + (extra_props or {}).get('Defense', 0),
        'Speed': t['Speed'] + gain.get('Speed', 0),
        'CritRate': t['CritRate'] + gain.get('CritRate', 0) + (extra_props or {}).get('CritRate', 0),
        'CritPower': t['CritPower'] + gain.get('CritPower', 0) + (extra_props or {}).get('CritPower', 0),
        'EffectHitRate': t['EffectHitRate'] + gain.get('EffectHitRate', 0),
        'EffectResistRate': t['EffectResistRate'] + gain.get('EffectResistRate', 0),
    }
    return {'yuhunPanel': yuhun_panel, 'finalPanel': final}


def team_value(hero, target, suit_combos, extra_props=None, equips=None):
    """chunks/assets_teamBase-e0e42ee9.js @921 p()：指标"数值"（不含副本伤害）"""
    t = hero_base(hero)
    pan = (panel_from_equips(hero, equips, extra_props) if equips
           else team_panel(hero, suit_combos, extra_props))['finalPanel']
    vals = {}
    if target == 'Damage':
        vals['数值'] = pan['Attack'] * pan['CritPower']
        if hero == '季':
            vals['数值'] = pan['Attack'] * (1 + pan['CritPower'] - t['CritPower'])
    elif target == 'DefenseDamage':
        vals['数值'] = pan['Defense'] * pan['CritPower']
    elif target == 'Healing':
        vals['数值'] = pan['Hp'] * pan['CritPower']
    elif target == 'Speed':
        vals['数值'] = pan['Speed']
    elif target == 'Hp':
        vals['数值'] = pan['Hp']
    elif target == 'Attack':
        vals['数值'] = pan['Attack']
    elif target == 'Defense':
        vals['数值'] = pan['Defense']
    elif target == 'CritPower':
        vals['数值'] = pan['CritPower']
    return vals


# ============================================================================
# 9. 固定挂件预设（teamBase @2950 R / R.因幡辉夜姬...）与 PVE 页面预设
# ============================================================================

def _sid(name):
    for sid, s in SUITS.items():
        if s['name'] == name:
            return sid
    raise KeyError(name)


def support_presets():
    """teamBase @2950 R：一键预设里的固定挂件（因幡辉夜姬/不见岳）"""
    return {
        '因幡辉夜姬': {
            'DEF': {'hero': '因幡辉夜姬', 'target': {'value': 'CritPower'},
                    'suitCombos': [{'id': _sid('火灵'), 'count': 4}],
                    'mainAttrs': {2: ['AttackRate', 'HpRate', 'DefenseRate'],
                                  4: ['AttackRate', 'HpRate', 'DefenseRate', 'EffectResistRate', 'EffectHitRate'],
                                  6: ['CritPower']},
                    'ignore': {'extraProps': True, 'injury': True}},
            'L128': None,
        },
        '不见岳': {
            'DEF': {'hero': '不见岳', 'target': {'value': 'Defense'},
                    'suitCombos': [],
                    'mainAttrs': {2: ['DefenseRate'], 4: ['DefenseRate'], 6: ['DefenseRate']},
                    'ignore': {'extraProps': True, 'injury': True}},
        },
    }


# PVE 预览页预设 —— chunks/assets_pvePreview-699e5d15.js @676..6069
PVE_PRESETS = [
    {'title': '魂土天照', 'hero': '天照', 'scene': '魂土',
     'propsLimit': {'Speed': {'min': 158, 'max': None}, 'CritRate': {'min': 100, 'max': None}},
     'suitCombos': [{'id': _sid('狂骨'), 'count': 4}, {'id': _sid('鬼灵歌伎'), 'count': 2}],
     'mainAttrs': {2: ['Speed', 'AttackRate'], 4: ['AttackRate'], 6: ['CritRate', 'CritPower', 'AttackRate']}},
    {'title': '魂王天照', 'hero': '天照', 'scene': '魂王',
     'propsLimit': {'Speed': {'min': 152, 'max': None}, 'CritRate': {'min': 100, 'max': None}},
     'suitCombos': [{'id': _sid('隐念'), 'count': 4}, {'id': _sid('鬼灵歌伎'), 'count': 2}],
     'mainAttrs': {2: ['Speed', 'AttackRate'], 4: ['AttackRate'], 6: ['CritRate', 'CritPower', 'AttackRate']}},
    {'title': '须佐之男', 'hero': '须佐之男',
     'propsLimit': {'CritRate': {'min': 100, 'max': None}},
     'suitCombos': [{'id': _sid('海月火玉'), 'count': 4}, {'id': _sid('土蜘蛛'), 'count': 2}],
     'mainAttrs': {2: ['AttackRate'], 4: ['AttackRate'], 6: ['CritRate', 'CritPower']}},
]


# ============================================================================
# 10. 一速预览算法（chunks/assets_speed-a4e3d7ab.js @12523）
# ============================================================================

def speed_preview(equips, quick=False):
    """一速页算法：散件一速×5 / 散件命中一速×3 / 散件抵抗一速×2 / 套装一速×14"""
    out = {'loose': [], 'hit': [], 'resist': [], 'suits': []}
    g = {0: '一', 1: '二', 2: '三', 3: '四', 4: '五'}
    # ---- 散件一速：mainAttrsLimit 2号位=Speed ----
    excludes = []
    for b in range(5):
        res = pt(equips, '天照', 'Speed', {'mainAttrsLimit': {2: ['Speed']}},
                 {'fastMode': True, 'excludes': [{'id': e['id']} for e in excludes]})
        if res and res[0]['yuhunGain'].get('Speed', 0) > 0:
            out['loose'].append({'kind': '散件%s速' % g[b],
                                 'value': res[0]['yuhunGain']['Speed'],
                                 'suit': res[0]['suit'],
                                 'yuhunGain': res[0]['yuhunGain']})
            excludes.extend(res[0]['suit'])
        if quick:
            break
    # ---- 散件命中一速：4号位=效果命中 ----
    excludes = []
    for b in range(3):
        res = pt(equips, '天照', 'Speed', {'mainAttrsLimit': {2: ['Speed'], 4: ['EffectHitRate']}},
                 {'fastMode': True, 'excludes': [{'id': e['id']} for e in excludes]})
        if res and res[0]['yuhunGain'].get('Speed', 0) > 0:
            out['hit'].append({'kind': '散件命中%s速' % g[b],
                               'value': res[0]['yuhunGain']['Speed'],
                               'suit': res[0]['suit'],
                               'yuhunGain': res[0]['yuhunGain']})
            excludes.extend(res[0]['suit'])
        if quick:
            break
    # ---- 散件抵抗一速：4号位=效果抵抗 ----
    excludes = []
    for b in range(2):
        res = pt(equips, '天照', 'Speed', {'mainAttrsLimit': {2: ['Speed'], 4: ['EffectResistRate']}},
                 {'fastMode': True, 'excludes': [{'id': e['id']} for e in excludes]})
        if res and res[0]['yuhunGain'].get('Speed', 0) > 0:
            out['resist'].append({'kind': '散件抵抗%s速' % g[b],
                                  'value': res[0]['yuhunGain']['Speed'],
                                  'suit': res[0]['suit'],
                                  'yuhunGain': res[0]['yuhunGain']})
            excludes.extend(res[0]['suit'])
        if quick:
            break
    # ---- 套装一速：14 个常用套装 4 件套 ----
    suit_list = ['招财猫', '火灵', '蚌精', '日女巳时', '薙魂', '共潜', '木魅', '魅妖',
                 '钟灵', '雪幽魂', '魍魉之匣', '轮入道', '狂骨', '骰子鬼']
    if quick:
        suit_list = suit_list[:2]
    for nm in suit_list:
        res = pt(equips, '天照', 'Speed',
                 {'suitCombos': [{'id': _sid(nm), 'count': 4}], 'mainAttrsLimit': {2: ['Speed']}},
                 {'fastMode': True})
        if res and res[0]['yuhunGain'].get('Speed', 0) > 0:
            out['suits'].append({'kind': nm, 'value': res[0]['yuhunGain']['Speed'],
                                 'suit': res[0]['suit'], 'yuhunGain': res[0]['yuhunGain']})
    out['suits'].sort(key=lambda r: -r['value'])
    return out


# ============================================================================
# 11. 跑分（score-distribution）统计
# ============================================================================

def score_distribution(equips, type_ids=None, std=True, pos_main=None,
                       pos2=('AttackRate',), pos4=('AttackRate',), pos6=('CritRate', 'CritPower')):
    """scoreDistribution-b8121b79.js @130874 u()：按 score 计数，构造 ECharts pie data"""
    pos_main = pos_main or {1: pos2, 3: pos4, 5: pos6}
    eq = list(equips)
    if type_ids:
        eq = [e for e in eq if int(e['suit_id']) in type_ids]
    eq = [e for e in eq if (len(e.get('single_attrs') or []) == 0) == bool(std)]
    out = []
    for e in eq:
        p = int(e['pos'])
        if p in pos_main and e['base_attr']['type'] not in pos_main[p]:
            continue
        if int(e.get('score', -1)) > -1:
            out.append(e)
    from collections import Counter
    cnt = Counter(int(e['score']) for e in out)
    data = [{'value': cnt[k], 'name': '%d分' % k} for k in sorted(cnt)]
    per_pos = {}
    for e in out:
        per_pos.setdefault(int(e['pos']), []).append(e)
    centers = ['25%', '50%', '75%', '25%', '50%', '75%']
    top = ['35%', '35%', '35%', '70%', '70%', '70%']
    pos_data = []
    for p in sorted(per_pos):
        c = Counter(int(e['score']) for e in per_pos[p])
        pos_data.append({'name': {0: '壹', 1: '贰', 2: '叁', 3: '肆', 4: '伍', 5: '陆'}[p],
                         'center': [centers[p], top[p]],
                         'data': [{'value': c[k], 'name': '%d分' % k} for k in sorted(c)]})
    return {'total': len(out), 'data': data, 'perPos': pos_data}


# ============================================================================
# 12. 演示 / 验证
# ============================================================================

def load_data(path):
    with open(path, encoding='utf-8') as f:
        d = json.load(f)
    data = d.get('data', d)
    eq = data.get('hero_equips') or data.get('eqData') or []
    player = data.get('player', {})
    return eq, player


def hr(t):
    print('\n' + '=' * 78 + '\n' + t + '\n' + '=' * 78)


def demo_indicators(equips):
    hr('① 御魂 indicator 复刻（server chunk 公式，按 random_attrs 计算）')
    e = max(equips, key=lambda x: x.get('score', 0))
    ind = equip_indicator(e)
    print('装备: %s %s %d号位 主属性=%s+%.3f' % (suit_name(e['suit_id']), e['id'], int(e['pos']) + 1,
                                         ATTR_CN.get(e['base_attr']['type'], e['base_attr']['type']),
                                         e['base_attr']['value']))
    print('副属性:', [(ATTR_CN.get(a['type'], a['type']), round(a['value'], 3)) for a in e['random_attrs']])
    print('indicator =', ind)
    print('服务器 score=%s zscore=%s' % (e.get('score'), e.get('zscore')))
    print('说明: indicator 是前端从 random_attrs 现算的; score/zscore 是服务端写进 yyx 的。')
    # 速度指标排序核对
    sp = [equip_indicator(x)['speed'] for x in equips]
    print('全库 indicator.speed 分布: min=%d max=%d mean=%.1f' % (min(sp), max(sp), sum(sp) / len(sp)))


def demo_rolls(equips):
    hr('② 御魂"成长次数"(=pruneScore 单位) 与标准评分的关系')
    import statistics
    T = []
    for e in equips:
        T.append(sum(rolls_of(e, a) for a in ATTR_CN if any(x['type'] == a for x in e['random_attrs'])))
    print('全库 random_attrs 总成长次数: mean=%.2f (理论上 4 条初始 + 5 次强化 ≈ 9 单位，'
          '因数值低于满成长故约 8)，min=%.2f max=%.2f' % (statistics.mean(T), min(T), max(T)))
    print('说明: score/zscore 由服务端生成，客户端仅展示/排序/过滤，无法从前端反推；'
          '但成长次数单位与其语义一致（"只计算有效属性的成长次数"）。')


def demo_pt(equips):
    hr('③ Worker 协议 + Pt 流水线：散件最高速度（一速预览的第一步）')
    res = pt(equips, '天照', 'Speed', {'mainAttrsLimit': {2: ['Speed']}}, {'fastMode': True})
    sample = build_message([], '天照', 'Speed', {'mainAttrsLimit': {2: ['Speed']}}, {'fastMode': True})
    print('worker 消息体字段(%d 个): %s' % (len(sample), ', '.join(sample.keys())))
    print('worker 回包: {id:Number, bulkRes:[{suit:[6×Equip], yuhunGain:{...}, target:String, value:Number}]}')
    print('返回条数=%d（worker 每批 top100 → 主线程 x2nd 排序后 slice(0,6)）' % len(res))
    top = res[0]
    print('best value(天照基础速度119 + 御魂速度合计)=%.2f  yuhunGain.Speed=%.2f' % (top['value'], top['yuhunGain']['Speed']))
    for e in top['suit']:
        sp = [x['value'] for x in e['random_attrs'] if x['type'] == 'Speed']
        print('  %d号位 %s 主属性=%s+%s 速度副属=%s' % (
            int(e['pos']) + 1, suit_name(e['suit_id']),
            ATTR_CN.get(e['base_attr']['type'], e['base_attr']['type']),
            round(e['base_attr']['value'], 2), round(sp[0], 2) if sp else '-'))
    # 交叉验证：单指标最优 = 天照基础速度 + 逐位置取最大速度副属（散件无套装约束）
    brute = hero_base('天照')['Speed']
    for pos in range(6):
        cand = [x for x in equips if int(x['pos']) == pos and int(x['quality']) == 6 and int(x['level']) == 15]
        if pos == 1:
            cand = [x for x in cand if x['base_attr']['type'] == 'Speed']
        best = 0.0
        for e in cand:
            p = precompute(e)
            best = max(best, p['Speed'])
        brute += best
    print('独立暴力校验（天照基础119 + 逐位置最大速度，散件无套装约束）: %.2f' % brute)
    print('DELTA = %.6f  -> %s' % (top['value'] - brute, 'PASS' if abs(top['value'] - brute) < 1e-6 else 'FAIL'))
    return res


def demo_consistency(equips):
    hr('③.5 面板/指标一致性对拍：worker 路径(worker Fn/Br/Wr/wo/Co) vs teamBase 面板路径(C())')
    sc = [{'id': _sid('狂骨'), 'count': 4}, {'id': _sid('鬼灵歌伎'), 'count': 2}]
    ok_all = True
    for tgt in ['Attack', 'Hp', 'Defense', 'CritPower']:
        best = pt(equips, '天照', tgt, {'suitCombos': sc}, {'fastMode': True})[0]
        pan = panel_from_equips('天照', best['suit'])['finalPanel']
        d = best['value'] - pan[tgt]
        ok_all &= abs(d) < 1e-9
        print('  %-10s worker=%.4f  teamBase=%.4f  delta=%.2e' % (tgt, best['value'], pan[tgt], d))
    best = pt(equips, '天照', 'Speed', {'mainAttrsLimit': {2: ['Speed']}}, {'fastMode': True})[0]
    pan = panel_from_equips('天照', best['suit'])['finalPanel']
    print('  %-10s worker=%.4f  teamBase=%.4f  delta=%.2e' % ('Speed', best['value'], pan['Speed'],
                                                             best['value'] - pan['Speed']))
    # Damage 简单模式：worker vo() == 面板攻击 × 面板爆伤
    best = pt(equips, '天照', 'Damage', {'suitCombos': sc}, {'fastMode': True})[0]
    pan = panel_from_equips('天照', best['suit'])['finalPanel']
    tv = team_value('天照', 'Damage', None, equips=best['suit'])['数值']
    print('  Damage 天照: worker=%.4f  teamBase=%.4f  面板Atk*CP=%.4f  %s' % (
        best['value'], tv, pan['Attack'] * pan['CritPower'],
        'PASS' if abs(best['value'] - pan['Attack'] * pan['CritPower']) < 1e-9 else 'FAIL'))
    # 季：worker 简单模式与 teamBase 口径差异（已知分歧，差 1 个面板攻击）
    best = pt(equips, '季', 'Damage', {'suitCombos': sc}, {'fastMode': True})[0]
    pan = panel_from_equips('季', best['suit'])['finalPanel']
    tv = team_value('季', 'Damage', None, equips=best['suit'])['数值']
    print('  Damage 季  : worker=%.4f  teamBase=%.4f  差=%.4f (=面板攻击 %.4f)' % (
        best['value'], tv, tv - best['value'], pan['Attack']))
    # 复杂模式 worker Ro() vs 手算 attack*cp*IF*BR + attack*gjFactor*2.55
    sc2 = [{'id': _sid('海月火玉'), 'count': 4}, {'id': _sid('鬼灵歌伎'), 'count': 2}]
    settings = {'fastMode': True, 'isPve': True, 'extras': [], 'team': [], 'teamValues': {},
                'strict': True, 'boss': BOSS_TABLE['魂王']['Boss']}
    best = pt(equips, '须佐之男', 'Damage', {'suitCombos': sc2}, settings)[0]
    pan = panel_from_equips('须佐之男', best['suit'])['finalPanel']
    msg = build_message([], '须佐之男', 'Damage', {'suitCombos': sc2}, settings)
    manual = (pan['Attack'] * pan['CritPower'] * msg['injuryFactor'] * msg['bearingRatio']
              + pan['Attack'] * msg['gjYuhunFactor'] * 2.55)
    print('  复杂模式须佐: worker=%.4f  手算=%.4f  差=%.2e  complexMode=%s' % (
        best['value'], manual, best['value'] - manual, msg['complexMode']))
    inj = injury({'hero': '须佐之男', 'suit': best['suit'], 'panel': pan}, [], {},
                 BOSS_TABLE['魂王']['Boss'], False, [])
    print('  wt() 口径(非暴击路径, strict=false)=%.4f（面板暴击率 %.4f <= 0.99 时走低值）'
          % (inj['injury'], pan['CritRate']))
    print('  结论: 面板/指标公式两套独立实现 %s' % ('一致 PASS' if ok_all else '存在偏差 FAIL'))


def demo_speed(equips, quick):
    hr('④ 一速预览四张表（speed-a4e3d7ab.js）')
    t0 = time.time()
    out = speed_preview(equips, quick=quick)
    for key, label in [('loose', '散件一速'), ('hit', '散件命中一速'), ('resist', '散件抵抗一速')]:
        print('\n[%s]' % label)
        for r in out[key]:
            print('  %-12s 一速=%.2f  %s' % (r['kind'], r['value'],
                                             ' + '.join(sorted({suit_name(e['suit_id']) for e in r['suit']}))))
    print('\n[套装一速] (4 件套, 按速度降序)')
    for r in out['suits']:
        print('  %-8s 一速=%.2f' % (r['kind'], r['value']))
    print('\n耗时 %.1fs' % (time.time() - t0))
    return out


def demo_pve(equips):
    hr('⑤ PVE 预览：预设阵容 → 最佳御魂 → 面板数值 + 对魂王 Boss 的伤害')
    print('注: PVE 页的"副本伤害计算"固定用 魂王.Boss(防580) 且 strict=0.99 '
          '(pvePreview @6763)；面板来自 teamBase C(hero, p.suit)')
    for preset in PVE_PRESETS:
        filters = {
            'propsLimit': {k: dict(v) for k, v in preset['propsLimit'].items()},
            'suitCombos': preset['suitCombos'],
            'mainAttrsLimit': preset['mainAttrs'],
        }
        res = pt(equips, preset['hero'], 'Damage', filters, {'fastMode': True})
        if not res:
            print('\n[%s] 无结果：裁剪后没有同时满足 %s 的 6 件套（示例数据量小，属预期）'
                  % (preset['title'], preset['propsLimit']))
            continue
        best = res[0]
        pan = panel_from_equips(preset['hero'], best['suit'])['finalPanel']
        val = team_value(preset['hero'], 'Damage', None, equips=best['suit'])['数值']
        print('\n[%s] 套装=%s' % (preset['title'], ' + '.join(sorted({suit_name(e['suit_id']) for e in best['suit']}))))
        print('  面板: 攻击=%.2f 暴击率=%.4f 爆伤=%.4f 速度=%.2f' % (
            pan['Attack'], pan['CritRate'], pan['CritPower'], pan['Speed']))
        print('  数值(攻击×爆伤)=%.2f' % val)
        # 自检：面板必须满足 propsLimit（CritRate 是百分比，Speed 为总速度）
        ok = True
        for k, lim in preset['propsLimit'].items():
            v = pan[k] * 100 if k == 'CritRate' else pan[k]
            if lim.get('min') is not None and v < lim['min']:
                ok = False
            if lim.get('max') is not None and v > lim['max']:
                ok = False
        print('  属性限制自检: %s' % ('PASS' if ok else 'FAIL'))
        team = [{'hero': '因幡辉夜姬'}, {'hero': '不见岳'}, {'hero': preset['hero']}]
        info = {'hero': preset['hero'], 'suit': best['suit'], 'panel': pan, 'values': {'数值': val}}
        st = injury(info, team, {}, BOSS_TABLE['魂王']['Boss'], True, [])
        print('  对 魂王.Boss 伤害: %s' % {k: round(v, 2) for k, v in st.items()})
        if '荒骷髅' in [suit_name(e['suit_id']) for e in best['suit']]:
            print('  荒骷髅 ×1.1 后数值 = %.2f' % (val * 1.1))


def demo_one_key(equips):
    hr('⑥ 一键预设：魂土 阵容#1（天照P1 + 须佐之男照须·火灵）')
    print('阵容定义来自 oneKeyCalcTeam @24760 (Za.teams[0])，逐式神按 team 数组顺序计算；')
    print('每个式神调用 Pt → 取 top1 → 用 wt() 算对 Boss 伤害 → 扣 bossRemainingHp → 排除已用御魂。')
    boss = BOSS_TABLE['魂土']['Boss']
    team_def = [
        {'hero': '天照', 'suitCombos': [{'id': _sid('狂骨'), 'count': 4}, {'id': _sid('鬼灵歌伎'), 'count': 2}],
         'target': {'value': 'Damage'}, 'goal': 24553,
         'propsLimit': {'CritRate': {'min': 100, 'max': None}, 'Speed': {'min': 158, 'max': None}},
         'mainAttrs': {2: ['Speed', 'AttackRate'], 4: ['AttackRate'], 6: ['AttackRate', 'CritRate', 'CritPower']},
         'extras': [{'type': 'nOfGlint', 'value': 7}, {'type': '攻击段数', 'value': 3},
                    {'type': '不触发歌姬'}, {'type': '指标计算简单化'}]},
        {'hero': '须佐之男', 'suitCombos': [{'id': _sid('火灵'), 'count': 4}, {'id': _sid('鬼灵歌伎'), 'count': 2}],
         'target': {'value': 'Damage'},
         'propsLimit': {'CritRate': {'min': 100, 'max': None}, 'Speed': {'min': 119, 'max': None}},
         'mainAttrs': {2: ['AttackRate'], 4: ['AttackRate'], 6: ['CritRate', 'CritPower']},
         'extras': [{'type': 'nOfGlint', 'value': 6}]},
    ]
    tv = {}
    excludes = []
    boss_hp = boss['Hp']
    total_injury = 0.0
    team_pass = True
    for member in team_def:
        filters = {'propsLimit': {k: dict(v) for k, v in member['propsLimit'].items()},
                   'suitCombos': member['suitCombos'], 'mainAttrsLimit': member['mainAttrs']}
        settings = {'fastMode': True, 'isPve': True,
                    'excludes': [{'id': e['id']} for e in excludes],
                    'extras': member['extras'], 'team': team_def, 'teamValues': tv,
                    'strict': True, 'boss': boss}
        res = pt(equips, member['hero'], 'Damage', filters, settings)
        if not res:
            print('  [%s] 未找到满足要求的御魂' % member['hero'])
            team_pass = False
            break
        best = res[0]
        pan = panel_from_equips(member['hero'], best['suit'])['finalPanel']
        info = {'hero': member['hero'], 'suit': best['suit'], 'panel': pan,
                'values': {'数值': team_value(member['hero'], 'Damage', None, equips=best['suit'])['数值']}}
        inj = injury(info, team_def, tv, boss, True, member['extras'])
        # 原实现（one-key @41329）对 魂土 天照 还跑 preCheck：必须一回合击杀 P1 清姬
        pre = None
        if member['hero'] == '天照':
            ex2 = member['extras'] + [{'type': '攻击段数', 'value': 3}, {'type': '不触发歌姬'}]
            pre = injury(info, team_def, tv, BOSS_TABLE['魂土']['P1']['清姬'], True, ex2)
        total_injury += inj['injury']
        boss_hp -= inj['injury']
        tv[member['hero']] = {'hero': member['hero'], 'suit': best['suit'], 'panel': pan,
                              'values': info['values'], 'pass': True}
        excludes.extend(best['suit'])
        print('\n  [%s] %s' % (member['hero'], ' + '.join(sorted({suit_name(e['suit_id']) for e in best['suit']}))))
        print('    指标数值=%.2f goal=%s' % (inj['injury'] if False else info['values']['数值'], member.get('goal')))
        print('    面板: 攻击=%.2f 暴击率=%.4f 爆伤=%.4f 速度=%.2f' % (
            pan['Attack'], pan['CritRate'], pan['CritPower'], pan['Speed']))
        print('    对 魂土.Boss(防577.28) 伤害=%s' % {k: round(v, 2) for k, v in inj.items()})
        if pre:
            left = BOSS_TABLE['魂土']['P1']['清姬']['Hp'] - pre['injury']
            print('    preCheck vs P1 清姬(Hp=%.2f): 伤害=%.2f 剩余=%.2f -> %s' % (
                BOSS_TABLE['魂土']['P1']['清姬']['Hp'], pre['injury'], left,
                'PASS' if left <= 0 else 'FAIL'))
            if left > 0:
                team_pass = False
                print('      failReason: 无法击杀 P1 的清姬, 清姬剩余生命值: %.2f' % left)
    boss_pass = boss_hp <= 0
    print('\n  队伍总伤害=%.2f   Boss 剩余生命=%.2f   可击杀=%s' % (total_injury, boss_hp, boss_pass))
    print('  一键预设通关判定(one-key @42697): O.pass = 1 当且仅当 bossRemainingHp<=0（非 uGoal 阵容）')
    print('  结论: %s（示例数据仅 4299 件随机御魂，达不到魂土面板要求属预期）'
          % ('PASS' if (boss_pass and team_pass) else 'FAIL'))


def demo_score(equips):
    hr('⑦ 御魂跑分统计（scoreDistribution）')
    out = score_distribution(equips)
    print('参与统计(标准御魂, 主属性命中默认筛选, score>-1) = %d 件' % out['total'])
    print('全位置 score 分布(pie data):')
    print('  ', out['data'])
    print('各位置 pie data（center = radius 环图中心，见 chunk @131800）:')
    for p in out['perPos']:
        print('  %s %s -> %s' % (p['name'], p['center'], p['data']))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=None)
    ap.add_argument('--quick', action='store_true')
    ap.add_argument('--skip', default='')
    args = ap.parse_args()
    base = os.path.dirname(os.path.abspath(__file__))
    path = args.data or os.path.join(base, '..', '..', 'zyj', 'assets', 'static_data_yys0.example.json')
    equips, player = load_data(path)
    print('数据: %s' % os.path.abspath(path))
    print('玩家: %s  御魂: %d 件' % (player, len(equips)))
    skip = set(args.skip.split(',')) if args.skip else set()
    if 'ind' not in skip:
        demo_indicators(equips)
    if 'rolls' not in skip:
        demo_rolls(equips)
    if 'pt' not in skip:
        demo_pt(equips)
    if 'consist' not in skip:
        demo_consistency(equips)
    if 'speed' not in skip:
        demo_speed(equips, args.quick)
    if 'pve' not in skip:
        demo_pve(equips)
    if 'onekey' not in skip:
        demo_one_key(equips)
    if 'score' not in skip:
        demo_score(equips)


if __name__ == '__main__':
    main()
