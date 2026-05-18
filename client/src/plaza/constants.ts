// 模型广场视觉常量。
//
// 圆角嵌套规则（与节点画布一致）：要让父级 WebGL 玻璃壳与内层灰矩形的圆角视觉同心，
// 必须满足  内层圆角 = 外层圆角 − 内边距。否则会出现"内层看起来更圆"的失配。
//
// DESIGN.md v0.2 写的是"父子圆角完全一致"，但节点画布实际代码（ModelNode 等）
// 是父 32 / 内 20 / padding 16，遵循几何同心。本广场沿用同一规则。

export const PLAZA_GLASS_RADIUS = 32;      // 外层 LiquidGlass shape radius
export const PLAZA_INNER_PADDING = 10;     // 外层壳到内层卡的内边距
export const PLAZA_INNER_RADIUS = PLAZA_GLASS_RADIUS - PLAZA_INNER_PADDING; // = 22
