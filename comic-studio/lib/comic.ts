import { z } from "zod";
export const styles = ["日系彩漫", "黑白漫画", "水彩绘本", "美式漫画"] as const;
const short = z.string().trim().min(1).max(180);
export const characterSchema = z.object({name:short, role:short, appearance:z.string().min(1).max(1200), personality:z.string().min(1).max(600)});
export const panelSchema = z.object({title:short, shot:short, scene:z.string().min(1).max(1600), dialogue:z.string().max(400)});
export const planSchema = z.object({title:short, summary:z.string().min(1).max(1200), script:z.string().min(1).max(8000), characters:z.array(characterSchema).min(1).max(4), panels:z.array(panelSchema).min(4).max(8)});
export const imageResponseSchema=z.object({image:z.string().max(12_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)});
export type Character=z.infer<typeof characterSchema>;
export type Panel=z.infer<typeof panelSchema> & {image?:string;stale?:boolean};
export type Project=Omit<z.infer<typeof planSchema>,"panels"> & {panels:Panel[];style:string;reference?:string;referenceStale?:boolean;boardStale?:boolean;demo:boolean};
export const sampleStory="一个怕黑的小女孩，在雨夜遇见一只会说话的邮差猫。她跟随猫走进巷尾邮局，发现一封寄给自己的信：原来勇气不是不害怕，而是愿意向前一步。";
export function sampleProject():Project{return {title:"雨夜邮差",summary:"一封写给自己的信，一场与勇气的不期而遇。",style:"日系彩漫",demo:true,script:"【第一幕 · 雨后的相遇】\n小雨蹲在巷口的路灯下，不敢走进漆黑的街道。一只背着红色邮包的白猫停在她脚边，礼貌地抬起头。\n\n【第二幕 · 特别的委托】\n白猫从邮包里取出一封信，信封上写着小雨的名字。它邀请她一起去巷尾的邮局。小雨犹豫了一下，握紧了雨伞。\n\n【第三幕 · 向前一步】\n小雨跟着猫走过暗巷，推开邮局的门。暖黄色灯光照亮她的脸，也照亮她一路留下的脚印。\n\n【第四幕 · 给勇敢的你】\n她展开信纸，上面写着：勇气不是不害怕，而是愿意向前一步。小雨回头望向街道，发现黑夜里也藏着星光。",characters:[{name:"小雨",role:"主角 · 10岁",appearance:"黑色齐耳短发，深棕色眼睛，明黄色带帽雨衣、黄色雨靴、棕色小书包，手持透明雨伞。",personality:"敏感、善良，有些怕黑，但愿意帮助别人。"},{name:"阿白",role:"伙伴 · 邮差猫",appearance:"纯白短毛猫，绿色眼睛，粉色鼻尖，背着有白色信封图案的砖红色微型邮包。",personality:"有礼貌、从容，喜欢用委婉的方式鼓励别人。"}],panels:[{title:"巷口的相遇",shot:"中景 · 平视",scene:"雨后蓝紫色的小巷里，小雨穿着黄色雨衣蹲在白猫身边。湿润地面反射路灯，巷尾邮局亮着橙色灯光。",dialogue:"阿白：晚上好，需要一位同行的邮差吗？",image:"/sample-postcat.png"},{title:"特别的收件人",shot:"特写 · 俯视",scene:"小雨与白猫在路灯下，白猫从红色邮包里取出奶白色信封。小雨惊讶地指着信封。",dialogue:"小雨：咦，这封信是寄给我的？"},{title:"推开那扇门",shot:"远景 · 背面",scene:"小雨跟随白猫走进巷尾邮局，黄雨衣在蓝紫色街巷中明亮醒目。门缝里的暖光落在她前方。",dialogue:"阿白：答案在里面。我们一起走吧。"},{title:"给勇敢的你",shot:"近景 · 平视",scene:"暖黄色邮局里，小雨读着信露出笑容，白猫坐在她旁边。窗外雨停了，夜空浮现几颗星。",dialogue:"勇气不是不害怕，而是愿意向前一步。"}]};}
export function imagePrompt(project:Pick<Project,"style"|"characters">, panel?:Panel){
 const cast=project.characters.map(c=>`${c.name}：${c.role}；外貌：${c.appearance}；性格：${c.personality}`).join("\n");
 return panel?`绘制单独一格漫画插画，画风：${project.style}。人物设定：\n${cast}\n本格标题：${panel.title}\n镜头：${panel.shot}\n画面：${panel.scene}\n严格沿用参考图中的人物脸型、发型、衣服、配饰和配色。不要把参考图的拼贴布局画进场景。一个连续画面，不要分格，不要文字、气泡、标题或水印。`:`创作漫画角色设定参考图，画风：${project.style}。\n${cast}\n白色背景，每个角色独立全身正面与侧面，展示一致的外观、服装、配饰、配色和身高比例。不要场景、文字、标题、对白、水印。`;
}
