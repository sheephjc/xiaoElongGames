export interface Member {
  id: string;
  avatar: string;
  name: string;
  intro: string;
  website: string;
  github: string;
  websiteLogo?: string;
  links: ('website' | 'github')[];
}

/**
 * 在这里填写七位成员的内容：
 * name：名称；intro：头像下的一句话介绍。
 * website：个人网页完整网址；github：个人 GitHub 完整网址（均以 https:// 开头）。
 * 留空时显示待填写的名称／介绍，链接图标暂不可点击。
 * avatar 对应 public/members 中的文件；id 决定参考图中的位置，请保留。
 * links 决定显示哪些图标：成员 1、2、4、5 显示 GitHub，成员 2 另显示个人网页。
 * websiteLogo：可选个人网站图标文件名，位于 public/members；不填写时使用网页图标。
 */
export const MEMBERS: Member[] = [
  // 斗部左侧：chui.jpg
  { id: 'chui', avatar: 'chui.jpg', name: 'chui', intro: '他山之石，可以攻玉。', website: '', github: 'https://github.com/xzlhxc', links: ['github'] },
  // 斗部上方：hu.jpg
  { id: 'hu', avatar: 'hu.jpg', name: 'HJC', intro: '似前', website: 'https://www.sheephjc.cn/', github: 'https://github.com/sheephjc', websiteLogo: 'woodstock.png', links: ['website', 'github'] },
  // 斗部右侧：a.jpg
  { id: 'a', avatar: 'a.jpg', name: 'can you feel my  world', intro: '中暑导致的', website: '', github: '', links: [] },
  // 斗部下方：mx.jpg
  { id: 'mx', avatar: 'mx.jpg', name: '哆啦X梦', intro: '这是一条小尾巴~', website: '', github: 'https://github.com/MXo-oDMX', links: ['github'] },
  // 斗柄第一位：guo.jpg
  { id: 'guo', avatar: 'guo.jpg', name: '莴韭', intro: '这是一条小尾巴~', website: '', github: 'https://github.com/sckall', links: ['github'] },
  // 斗柄第二位：chili.jpg
  { id: 'chili', avatar: 'chili.jpg', name: 'HSX', intro: '这是一条小尾巴~', website: '', github: '', links: [] },
  // 斗柄末端：daimeng-hf.jpg
  { id: 'daimeng-hf', avatar: 'daimeng-hf.jpg', name: 'offset', intro: '这是一条小尾巴~', website: '', github: '', links: [] },
];
