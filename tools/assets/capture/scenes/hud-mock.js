// SP08 Task 2: static composition only. Production HUD/state/ownership belong to Tasks 4/5.
import renderLevel from './l4-frame.js';
import ui from '../../../../apps/web/assets/ui/manifest.json';
import manifest from '../../../../apps/web/assets/manifest.json';
export default async ({ canvas, name }) => {
  await renderLevel({ canvas });
  const base = __WEB_ASSETS__, layout = ui.layout;
  const scale = Math.max(layout.scale.min, Math.min(layout.scale.max, innerWidth / 1600, innerHeight / 900));
  const font = new FontFace(ui.font.family, `url(${base}/${ui.font.path})`);
  await font.load(); document.fonts.add(font);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;color:#fff;font-family:Coiny,system-ui,sans-serif';
  document.body.append(host);
  const px = n => `${n * scale}px`;
  const image = (id, css) => { const el=document.createElement('img'); el.src=`${base}/${ui.sprites[id].path}`; el.style.cssText=`position:absolute;object-fit:contain;${css}`; host.append(el); return el; };
  image('back', `left:${px(layout.back.left)};top:${px(layout.back.top)};width:${px(layout.back.width)};height:${px(layout.back.height)}`);
  image('soundOn', `right:${px(layout.mute.right)};top:${px(layout.mute.top)};width:${px(layout.mute.width)};height:${px(layout.mute.height)}`);
  // White source sprite is the rounded backing; inset colour strip leaves a faithful white outline.
  const bar=document.createElement('div');
  bar.style.cssText=`position:absolute;left:50%;transform:translateX(-50%);top:${px(layout.ownership.top)};width:${px(layout.ownership.width)};height:${px(layout.ownership.height)};border-radius:${px(layout.ownership.radius)};overflow:hidden;background:url(${base}/${ui.sprites.barBack.path}) center/100% 100%;filter:drop-shadow(0 ${px(2)} ${px(1)} #34586d99)`;
  const fills=document.createElement('div');
  fills.style.cssText=`position:absolute;inset:${px(layout.ownership.border)};border-radius:${px(layout.ownership.radius)};overflow:hidden;display:flex`;
  for(const [color,width] of [['blue',42],['red',26],['green',20],['yellow',12]]) {const segment=document.createElement('span');segment.style.cssText=`width:${width}%;background:${manifest.palettes[color]}`;fills.append(segment);}
  bar.append(fills);host.append(bar);
  const label=document.createElement('div');label.textContent='LEVEL 1';label.style.cssText=`position:absolute;left:50%;transform:translateX(-50%);top:${px(layout.level.top)};font-size:${px(layout.level.fontSize)};line-height:1.2;-webkit-text-stroke:${px(1)} #3d567d;text-shadow:0 ${px(2)} #3d567d`;host.append(label);
  if(name==='restart-mock') {
    const veil=document.createElement('div');veil.style.cssText='position:absolute;inset:0;background:#10244388;display:grid;place-items:center';host.append(veil);
    const popup=document.createElement('div');popup.style.cssText=`box-sizing:border-box;width:${px(layout.popup.width)};padding:${px(layout.popup.padding)};text-align:center;border:3px solid transparent;border-image:url(${base}/${ui.sprites.popup.path}) 30 fill / ${px(24)};border-radius:${px(layout.popup.radius)};box-shadow:0 6px 0 #4a5c86`;veil.append(popup);
    const title=document.createElement('div');title.textContent='DO YOU WANT TO RESTART THE BATTLE?';title.style.cssText=`font-size:${px(28)};line-height:1.3;color:#fff;-webkit-text-stroke:1px #45537a;margin-bottom:${px(24)}`;popup.append(title);
    for(const text of ['RESTART','CONTINUE','LEVELS']) {const action=document.createElement('div');const primary=text==='RESTART';action.textContent=text;action.style.cssText=`box-sizing:border-box;margin:${px(layout.action.gap)} auto 0;width:${px(layout.action.width)};height:${px(layout.action.height)};display:grid;place-items:center;font-size:${px(25)};-webkit-text-stroke:1px #465a7f;border-image-source:url(${base}/${ui.sprites[primary?'primary':'secondary'].path});border-image-slice:${primary?'30':'26'} fill;border-image-width:${px(22)};text-shadow:0 2px #3d567d`;popup.append(action);}
  }
  await Promise.all([...host.querySelectorAll('img')].map(el=>el.decode()));
  window.__hudMock = { scale, spriteIds: Object.keys(ui.sprites), static: true };
};
