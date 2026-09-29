import { newId, nowIso, openDatabase } from '../src/db.js';

const SOURCES = [
  { name: '中国政府网·政策文件库', level: 'national', jurisdictionName: '全国', sourceType: 'html_listing', baseUrl: 'https://www.gov.cn/zhengce/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '国家发展改革委', level: 'national', jurisdictionName: '全国', sourceType: 'html_listing', baseUrl: 'https://www.ndrc.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '财政部', level: 'national', jurisdictionName: '全国', sourceType: 'html_listing', baseUrl: 'https://www.mof.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '商务部', level: 'national', jurisdictionName: '全国', sourceType: 'html_listing', baseUrl: 'https://www.mofcom.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '工业和信息化部', level: 'national', jurisdictionName: '全国', sourceType: 'html_listing', baseUrl: 'https://www.miit.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '农业农村部', level: 'national', jurisdictionName: '全国', sourceType: 'html_listing', baseUrl: 'http://www.moa.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '国家政务服务平台', level: 'national', jurisdictionName: '全国', sourceType: 'html_listing', baseUrl: 'https://gjzwfw.www.gov.cn/', accessMethod: 'manual', frequency: 'manual' },
  { name: '北京市商务局', level: 'province', jurisdictionName: '北京市', sourceType: 'html_listing', baseUrl: 'https://sw.beijing.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '上海市商务委员会', level: 'province', jurisdictionName: '上海市', sourceType: 'html_listing', baseUrl: 'https://sww.sh.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '广东省商务厅', level: 'province', jurisdictionName: '广东省', sourceType: 'html_listing', baseUrl: 'https://com.gd.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '浙江省商务厅', level: 'province', jurisdictionName: '浙江省', sourceType: 'html_listing', baseUrl: 'http://zcom.zj.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '江苏省商务厅', level: 'province', jurisdictionName: '江苏省', sourceType: 'html_listing', baseUrl: 'http://swt.jiangsu.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '山东省商务厅', level: 'province', jurisdictionName: '山东省', sourceType: 'html_listing', baseUrl: 'http://commerce.shandong.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '四川省商务厅', level: 'province', jurisdictionName: '四川省', sourceType: 'html_listing', baseUrl: 'https://swt.sc.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '河南省商务厅', level: 'province', jurisdictionName: '河南省', sourceType: 'html_listing', baseUrl: 'https://hnsswt.henan.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '湖北省商务厅', level: 'province', jurisdictionName: '湖北省', sourceType: 'html_listing', baseUrl: 'http://swt.hubei.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
  { name: '安徽省商务厅', level: 'province', jurisdictionName: '安徽省', sourceType: 'html_listing', baseUrl: 'https://commerce.ah.gov.cn/', accessMethod: 'manual', frequency: 'weekly' },
];

const db = openDatabase();
const existing = new Set(db.prepare('SELECT name FROM sources').all().map((row) => row.name));
const insert = db.prepare(`
  INSERT INTO sources (
    id, name, level, jurisdiction_code, jurisdiction_name, base_url, listing_url, source_type,
    access_method, frequency, enabled, compliance_note, created_at, updated_at
  ) VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, 1, ?, ?, ?)
`);
let inserted = 0;
for (const source of SOURCES) {
  if (existing.has(source.name)) continue;
  const timestamp = nowIso();
  insert.run(
    newId(),
    source.name,
    source.level,
    source.jurisdictionName,
    source.baseUrl,
    source.sourceType,
    source.accessMethod,
    source.frequency,
    '仅采集公开政策公告；正式启用前请补充具体栏目地址、访问条款和负责人。',
    timestamp,
    timestamp,
  );
  inserted += 1;
}
console.log(`数据源种子完成：新增 ${inserted} 个，当前共 ${db.prepare('SELECT COUNT(*) AS count FROM sources').get().count} 个。`);
db.close();
