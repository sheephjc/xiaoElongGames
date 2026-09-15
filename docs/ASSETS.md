# 《鳄龙咆哮》素材资产与视觉参考方案

## 小鳄龙之家成员头像

七张成员头像由用户提供，从 `D:/Desktop/小鳄龙桌面组件/client/src/assets/deities` 原样复制到
`apps/web/public/members/`，原目录未修改。文件为 `a.jpg`、`chili.jpg`、`chui.jpg`、
`daimeng-hf.jpg`、`guo.jpg`、`hu.jpg`、`mx.jpg`，用于成员介绍页。
此处仅记录用户提供的素材来源，不将这些头像标注为 CC0；成员链接图标使用内联 SVG。

成员页合照背景由用户提供，从 `D:/Desktop/6fe217f39de248e6298c6c6d5a8a80db.jpg`
原样复制为 `apps/web/public/members/background.jpg`，模糊通过 CSS 实现，不修改原图。
HJC 的网站图标从 `D:/Desktop/sheephjc/sheephjc.github.io/assets/images/Woodstock.png`
原样复制为 `apps/web/public/members/woodstock.png`，配置在成员的 `websiteLogo` 字段中。

> 回答“音效/交互/素材能不能上网获取”：**可以**。本阶段已实际从 [Kenney](https://kenney.nl)
> 下载 CC0 素材包并把木箱模型接入场景；音效当前使用 WebAudio 程序化合成（零版权风险），
> 后续可按本文件逐步替换为 CC0 实录音效与正式枪模。

## 1. 已接入的素材（本次提交）

| 素材 | 来源 | 许可证 | 用途 | 位置 |
|------|------|--------|------|------|
| `crate-small/medium/wide.glb`（colormap 贴图已内嵌） | [Kenney · Blaster Kit 2.1](https://kenney.nl/assets/blaster-kit)（直链 zip 已归档 `tools/assets-archive/`，1.6MB） | **CC0**（公有领域，可商用，署名非必须） | 竞技场掩体木箱替换占位盒 | `games/corcodragon-fight/assets/models/` |
| `blaster-a.glb`（步枪）/ `blaster-e.glb`（狙击）/ `blaster-h.glb`（手枪），colormap 贴图已内嵌 | 同上 | **CC0** | 第一人称枪模（GLTFLoader 加载，失败回退程序化枪模） | `games/corcodragon-fight/assets/models/` |
| `characters/hero-{barbarian,rogue-hooded,knight,mage,rogue}.glb` | [KayKit · Character Pack Adventures 1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) | **CC0**（包内 `LICENSE-KayKit.txt` 已随资产保存） | 5 位英雄的低多边形角色模型（替换胶囊人视觉；引擎碰撞箱不变） | `games/corcodragon-fight/assets/models/characters/` |
| 程序化音效（射击/命中/爆头/击杀/换弹/技能/终极技/跳跃/治疗/重生） | 自研 WebAudio（`fx.ts`） | 自有 | 全部音效 | `games/corcodragon-fight/fx.ts` |
| 程序化匕首模型 + 挥砍动画 | 自研 Three.js 几何体 | 自有 | 近战武器 | `GameUI.tsx` |

> 下载前已核对包内 `License.txt`：CC0 1.0，允许个人/教育/商业使用。
> 完整包（含 18 支 blaster 枪模 FBX/GLB、弹药、手雷等）保存在
> `tools/assets-archive/kenney_blaster-kit_2.1.zip`（gitignore，不占仓库体积）。
>
> ⚠️ 上述 6 个 Kenney GLB 原本引用外部 `Textures/colormap.png`：dev 模式能加载，
> 但 Vite 生产构建会把 `.glb` 哈希化、外部贴图不跟随，导致打包后箱子/枪全白。
> 已用 `scripts/embed-glb-textures.mjs` 把贴图内嵌进每个 GLB（原 PNG 仍保留在
> `assets/models/Textures/` 供重新生成）；**以后替换这些 GLB 后需重跑该脚本**。

## 2. 可用的免费/CC0 素材来源（已联网调研）

### 音效

- [Freesound](https://freesound.org/)：搜索时按 `License: Creative Commons 0` 过滤，
  即可拿到可商用的 CC0 实录音效（枪声/脚步/环境音）。
- [OpenGameArt](https://opengameart.org/)：CC0 / CC-BY 游戏音效包（注意逐个核对 license）。
- [Kenney 音频包](https://kenney.nl/assets?q=audio)：CC0，含 UI/冲击/射击风格音效。
- [Creazilla 免费音频区](https://creazilla.com/media/audio)：大量 CC0 音效。

### 3D 模型与贴图

- [Kenney Blaster Kit](https://kenney.nl/assets/blaster-kit)（CC0，枪械/弹药/木箱）✅ 已下载；
- [Kenney 全站资产](https://kenney.nl/assets)：CC0 主题包（科幻/自然/室内）；
- [OpenGameArt 3D 区](https://opengameart.org/art-search-advanced?field_art_type_tid%5B%5D=10)：
  CC0/CC-BY 枪械与场景模型；
- [Poly Pizza](https://poly.pizza/) / [Quaternius](https://quaternius.com/)：
  低多边形模型（部分 CC0）。

### 开源浏览器 FPS 参考（联网调研结果）

| 项目 | 可借鉴点 | 链接 |
|------|----------|------|
| `luckeyfaraday/pastel-nuketown` | 浏览器 FPS 架构：主机权威 WebSocket、AI bot、LAN 玩法 | [GitHub](https://github.com/luckeyfaraday/pastel-nuketown) |
| `vincenzo-afk/NIGHTFALL` | TS+Three.js+Socket.IO 多人 FPS，英雄/模式/地图组织方式 | [GitHub](https://github.com/vincenzo-afk/NIGHTFALL) |
| `nickyvanurk/3d-multiplayer-browser-shooter` | 经典 three.js+ws 多人射击样板（插值/同步） | [GitHub](https://github.com/nickyvanurk/3d-multiplayer-browser-shooter) |
| `rhulha/Instagib2` | WebGL Quake3 地图 + Octree 碰撞思路 | [GitHub](https://github.com/rhulha/Instagib2) |

**向无畏契约（Valorant）看齐时，我们优先借鉴的是“感觉层”而不是素材**：
短杠准星 + 命中变红 X、狙击镜内视野、击杀确认弹出、低血量红屏、后坐视角上跳、
简洁 HUD（血/弹药/技能角标）、干净的角色轮廓。这些已在本阶段逐步落地。

## 3. 下一步接入计划（建议顺序）

1. ~~枪模替换~~ ✅ 已完成：`blaster-a/e/h.glb` 已接入步枪/狙击/手枪
   （vision 复核“枪管朝前、正常握持、无错位/遮挡”），匕首保留程序化挥砍刀；
2. **实录音效替换**：从 Freesound/OpenGameArt 下载 CC0 音效（每类选 2-3 个候选），
   按 `fx.ts` 的接口替换为 `AudioBuffer` 播放；保留程序化音效作为 fallback；
3. **脚步/环境音**：给英雄速度加脚步声节拍，场景加风/环境底噪（音量可调）；
4. **地图皮肤**：用 Kenney 科幻/自然包替换地板与围墙贴图，做 1-2 套主题（白天/夜间）；
5. **角色模型**：评估 Quaternius/Poly Pizza 的机器人或低模角色，替换胶囊角色
   （保持碰撞盒不变，只换视觉层）。

## 4. 素材引入规则（Agent 必读）

1. 只引入 **CC0 / 自研** 素材进 git；CC-BY 需保留署名文件；其他许可证一律不进仓库。
2. 原始下载包放 `tools/assets-archive/`（gitignore），**不要**提交大 zip。
3. 拷贝进 `games/corcodragon-fight/assets/` 的文件必须附带对应 `License.txt` 与来源。
4. 任何外网下载前在 `docs-dev/RISK_LOG.md` 登记（本次为 #31），下载后回填结果。
5. 二进制大文件控制体积：单文件 >5MB 先压缩/降面；GLB 优先（内嵌贴图，少文件依赖）。
