import {useEffect,useRef} from 'react';
import {Globe,BriefcaseBusiness,Image,Link2,BookOpen,MapPin,FileText,ContactRound,BadgeCheck,QrCode,Share2,Download,Eye,ShieldCheck,ClipboardCheck,Bell,Mic,MessageCircle,Smartphone,Languages,Wallet,Gift,Users,Brain,CalendarDays,ChartNoAxesCombined,UserRound} from 'lucide-react';
import {useApp} from './lib';
import './feature-showcase.css';
export const featureGroups=[
 {id:'identity',ar:'هويتك وموقعك',en:'Your identity and website',items:[
  {icon:Globe,ar:'عنوان يعبّر عنك',en:'An address of your own',text:'موقع مستقل على ksa.men، وتعديل اسم الرابط بطلب يعتمد من المشرف.',english:'Your own ksa.men website, with reviewed requests to change its address.'},
  {icon:BriefcaseBusiness,ar:'ملف مهني متكامل',en:'A complete professional profile',text:'نبذة وخبرات وتعليم وتدريب ومهارات وعضويات ولغات وهوايات وإنجازات.',english:'Biography, experience, education, training, skills, memberships, languages, hobbies and achievements.'},
  {icon:Image,ar:'شواهد وأعمال واضحة',en:'Evidence and portfolio',text:'أربع صور للمهارة وأربع لنماذج الأعمال، رفع جماعي ومعاينة كاملة بالتكبير.',english:'Four skill-evidence and four portfolio images, batch upload and full-image viewing.'},
  {icon:UserRound,ar:'تصميم يحمل هويتك',en:'Your own visual identity',text:'شعار وصورة وغلاف، مع هوية المنصة افتراضياً ومظهر داكن أو فاتح.',english:'Your photo, logo and cover, with platform defaults and light or dark appearance.'},
  {icon:Link2,ar:'روابطك في مكان واحد',en:'All your links together',text:'أيقونات التواصل الثمانية، يوتيوب، وروابط وأزرار مخصصة أنيقة.',english:'Eight social icons, YouTube, and elegant custom links and buttons.'},
  {icon:BookOpen,ar:'مدونتك ومساحتك الخاصة',en:'Your journal and private space',text:'شارك ما تختاره في مدونتك، واحتفظ بملاحظاتك الخاصة بعيداً عن الزائر.',english:'Share selected journal entries and keep personal notes away from visitors.'},
  {icon:MapPin,ar:'اكتشاف حسب تخصصك',en:'Discovery by expertise',text:'بحث بالاسم والمعرّف والتخصص والمدينة، للهويات المنشورة المسموح ظهورها.',english:'Search approved public identities by name, ID, expertise and city.'},
 ]},
 {id:'outputs',ar:'المشاركة والمخرجات',en:'Sharing and downloads',items:[
  {icon:FileText,ar:'بروفايل فاخر أفقي',en:'Executive landscape profile',text:'ملف PDF تعريفي أفقي بخط عربي وصور وهوية بصرية من بياناتك.',english:'A landscape PDF with Arabic typography, photos and branding from your profile.'},
  {icon:ClipboardCheck,ar:'سيرة مهيأة للقراءة الآلية',en:'An ATS-friendly résumé',text:'سيرة PDF نصية منظمة، مع خيارات تنزيل إضافية؛ دون ضمان قبول كل نظام.',english:'An organized text-based PDF résumé with additional download options; no universal ATS acceptance promise.'},
  {icon:BadgeCheck,ar:'بطاقة المعارض والمؤتمرات',en:'Conference and exhibition badge',text:'بطاقة عمودية رقمية وقابلة للطباعة، وصورة PNG وملف PDF للبطاقة.',english:'A vertical digital and printable badge, with PNG and PDF downloads.'},
  {icon:QrCode,ar:'رمزان يحملان شعارك',en:'Two codes carrying your mark',text:'رمز لموقعك وآخر لبطاقة الاتصال، بشعار افتراضي أو صورتك، وPNG خفيف.',english:'Website and contact-card QR codes with your image or the default mark, plus light PNG downloads.'},
  {icon:ContactRound,ar:'بطاقة اتصال جاهزة',en:'A ready-to-save contact card',text:'ملف vCard لحفظ معلومات الاتصال التي اخترت إظهارها على الهاتف.',english:'A vCard file to save the contact information you choose to share.'},
  {icon:Share2,ar:'تعارف برابط مختصر',en:'Introductions with a short link',text:'رابط تعارف قصير ومحدد المدة والبيانات، مع خيارات مشاركة سهلة.',english:'A short introduction link with selected fields and expiry, ready to share.'},
  {icon:Download,ar:'هدية QR للجميع',en:'A free QR tool for everyone',text:'أنشئ رمز رابط أو بطاقة اتصال من المتصفح دون تسجيل، مع شعار المنصة.',english:'Create a website or contact QR locally in your browser without signing in.'},
 ]},
 {id:'experience',ar:'سهولة وتحكم',en:'Ease and control',items:[
  {icon:Eye,ar:'معاينة قبل النشر',en:'Preview before publication',text:'راجع موقعك كاملاً من المسودة، ثم أرسل طلب النشر للمشرف.',english:'Preview your draft website in full, then submit it for publication.'},
  {icon:ShieldCheck,ar:'خصوصية تختارها أنت',en:'Privacy you choose',text:'إظهار وإخفاء للبيانات والصور والمخرجات، وإخفاء الموقع أو تقييد الوصول.',english:'Control fields, photos and downloads; hide your site or restrict access.'},
  {icon:Mic,ar:'كتابة وإملاء اختياري',en:'Typing and optional dictation',text:'إملاء بالعربية والإنجليزية، إيقاف يدوي أو بعد الصمت، حسب دعم متصفحك.',english:'Arabic and English dictation with manual or silence-based stopping, where supported.'},
  {icon:MessageCircle,ar:'سند معك',en:'Sanad beside you',text:'دليل تفاعلي بصوت وحركة، يساعدك في التنقل وفهم الأدوات مع تحكمك به.',english:'An interactive voice and animated guide, under your control.'},
  {icon:Bell,ar:'رسائل وإشعارات منظمة',en:'Organized messages and alerts',text:'إشعارات داخلية قابلة للإدارة، وطلبات تواصل ورسائل بموافقة أصحابها.',english:'Manageable in-app notifications, consent-based contact requests and messages.'},
  {icon:Smartphone,ar:'تطبيق على شاشة هاتفك',en:'An app on your home screen',text:'نسخة PWA قابلة للتثبيت؛ وإتاحة البطاقة المنشورة المختارة دون اتصال.',english:'Installable PWA, with selected published badge availability offline.'},
  {icon:Languages,ar:'العربية والإنجليزية',en:'Arabic and English',text:'واجهة باللغتين، ومخرجات عربية أو إنجليزية بحسب بياناتك المتاحة.',english:'Bilingual interface and Arabic or English downloads from available profile data.'},
  {icon:ChartNoAxesCombined,ar:'معلومات تدعم مسيرتك',en:'Information supporting your career',text:'رادار للمعلومات المهنية، وإرشادات اكتمال الملف ومؤشرات جودة واضحة.',english:'Professional information radar, profile completion guidance and clear quality signals.'},
 ]},
 {id:'loyalty',ar:'ولاء وقيمة مشتركة',en:'Loyalty and shared value',items:[
  {icon:Wallet,ar:'نقاط للتقدير والإهداء',en:'Points for recognition and gifts',text:'رصيد تميز مهني وإهداء نقاط موثق؛ النقاط غير نقدية وغير قابلة للاسترداد.',english:'Professional recognition points and documented gifting; points are non-cash and non-redeemable.'},
  {icon:Users,ar:'شارك أثر المنصة',en:'Share the platform’s impact',text:'رابط إحالة وإسناد واضح، ومكافأة بعد اعتماد استحقاق الإحالة وفق السياسة.',english:'Referral links and attribution, with rewards after policy-based approval.'},
  {icon:Gift,ar:'بطاقة تهديها لصديق',en:'A card to gift a friend',text:'بطاقة QR شخصية تجهزها من ركن الولاء وتشاركها عبر واتساب.',english:'Prepare a personal QR gift card in the loyalty corner and share it through WhatsApp.'},
  {icon:Brain,ar:'تمارين ذهنية سريعة',en:'Quick brain exercises',text:'تمارين يومية للذاكرة والتركيز وسرعة البديهة، مع أوسمة اختيارية.',english:'Daily memory, focus and quick-thinking exercises with optional badges.'},
  {icon:CalendarDays,ar:'مناسبات ومجتمعات',en:'Occasions and communities',text:'لمسات المناسبات الوطنية اختيارياً، وبرامج ومسابقات وقنوات عند تفعيلها.',english:'Optional national-occasion touches and programmes, competitions and channels when enabled.'},
 ]},
] as const;
export default function FeatureShowcase(){
 const {t}=useApp(),ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const node=ref.current;if(!node||!('IntersectionObserver'in window))return;const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){(entry.target as HTMLElement).dataset.revealed='true';observer.unobserve(entry.target);}}, {threshold:.08});node.querySelectorAll('[data-feature]').forEach(card=>observer.observe(card));return()=>observer.disconnect();},[]);
 return <div className="feature-showcase" ref={ref}><nav className="feature-showcase__jump" aria-label={t('مجموعات المزايا','Feature groups')}>{featureGroups.map(group=><a href={'#features-'+group.id} key={group.id}>{t(group.ar,group.en)}</a>)}</nav><p className="feature-showcase__note">{t('الموقع الأساسي وQR مستمران بعد التجربة. بعض الأدوات بحسب عضويتك، والبرامج الخاصة عند إعلانها.','Your basic site and QR continue after the trial. Some tools depend on membership; special programmes appear when announced.')}</p>{featureGroups.map(group=><section className="feature-showcase__group" id={'features-'+group.id} key={group.id} aria-labelledby={'feature-heading-'+group.id}><h2 id={'feature-heading-'+group.id}>{t(group.ar,group.en)}</h2><div className="feature-showcase__cards">{group.items.map((item,index)=><article className="feature-showcase__card" data-feature key={item.ar} style={{animationDelay:(index%3)*40+'ms'}}><span className="feature-showcase__icon"><item.icon size={23} aria-hidden="true"/></span><h3>{t(item.ar,item.en)}</h3><p>{t(item.text,item.english)}</p></article>)}</div></section>)}</div>;
}
