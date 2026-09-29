const PROVINCE_DEFINITIONS = [
  ['北京市', ['北京市', '北京']],
  ['天津市', ['天津市', '天津']],
  ['上海市', ['上海市', '上海']],
  ['重庆市', ['重庆市', '重庆']],
  ['河北省', ['河北省', '河北']],
  ['山西省', ['山西省', '山西']],
  ['辽宁省', ['辽宁省', '辽宁']],
  ['吉林省', ['吉林省', '吉林']],
  ['黑龙江省', ['黑龙江省', '黑龙江']],
  ['江苏省', ['江苏省', '江苏']],
  ['浙江省', ['浙江省', '浙江']],
  ['安徽省', ['安徽省', '安徽']],
  ['福建省', ['福建省', '福建']],
  ['江西省', ['江西省', '江西']],
  ['山东省', ['山东省', '山东']],
  ['河南省', ['河南省', '河南']],
  ['湖北省', ['湖北省', '湖北']],
  ['湖南省', ['湖南省', '湖南']],
  ['广东省', ['广东省', '广东']],
  ['海南省', ['海南省', '海南']],
  ['四川省', ['四川省', '四川']],
  ['贵州省', ['贵州省', '贵州']],
  ['云南省', ['云南省', '云南']],
  ['陕西省', ['陕西省', '陕西']],
  ['甘肃省', ['甘肃省', '甘肃']],
  ['青海省', ['青海省', '青海']],
  ['内蒙古自治区', ['内蒙古自治区', '内蒙古']],
  ['广西壮族自治区', ['广西壮族自治区', '广西']],
  ['西藏自治区', ['西藏自治区', '西藏']],
  ['宁夏回族自治区', ['宁夏回族自治区', '宁夏']],
  ['新疆维吾尔自治区', ['新疆维吾尔自治区', '新疆']],
  ['台湾省', ['台湾省', '台湾']],
  ['香港特别行政区', ['香港特别行政区', '香港']],
  ['澳门特别行政区', ['澳门特别行政区', '澳门']],
];

const MUNICIPALITIES = new Set(['北京市', '天津市', '上海市', '重庆市']);

const CITY_PROVINCE = new Map([
  ...['广州市', '深圳市', '珠海市', '汕头市', '佛山市', '韶关市', '湛江市', '肇庆市', '江门市', '茂名市', '惠州市', '梅州市', '汕尾市', '河源市', '阳江市', '清远市', '东莞市', '中山市', '潮州市', '揭阳市', '云浮市'].map((city) => [city, '广东省']),
  ...['杭州市', '宁波市', '温州市', '嘉兴市', '湖州市', '绍兴市', '金华市', '衢州市', '舟山市', '台州市', '丽水市'].map((city) => [city, '浙江省']),
  ...['南京市', '无锡市', '徐州市', '常州市', '苏州市', '南通市', '连云港市', '淮安市', '盐城市', '扬州市', '镇江市', '泰州市', '宿迁市'].map((city) => [city, '江苏省']),
  ...['合肥市', '芜湖市', '蚌埠市', '淮南市', '马鞍山市', '淮北市', '铜陵市', '安庆市', '黄山市', '滁州市', '阜阳市', '宿州市', '六安市', '亳州市', '池州市', '宣城市'].map((city) => [city, '安徽省']),
  ...['福州市', '厦门市', '莆田市', '三明市', '泉州市', '漳州市', '南平市', '龙岩市', '宁德市'].map((city) => [city, '福建省']),
  ...['南昌市', '景德镇市', '萍乡市', '九江市', '新余市', '鹰潭市', '赣州市', '吉安市', '宜春市', '抚州市', '上饶市'].map((city) => [city, '江西省']),
  ...['济南市', '青岛市', '淄博市', '枣庄市', '东营市', '烟台市', '潍坊市', '济宁市', '泰安市', '威海市', '日照市', '临沂市', '德州市', '聊城市', '滨州市', '菏泽市'].map((city) => [city, '山东省']),
  ...['郑州市', '开封市', '洛阳市', '平顶山市', '安阳市', '鹤壁市', '新乡市', '焦作市', '濮阳市', '许昌市', '漯河市', '三门峡市', '南阳市', '商丘市', '信阳市', '周口市', '驻马店市'].map((city) => [city, '河南省']),
  ...['武汉市', '黄石市', '十堰市', '宜昌市', '襄阳市', '鄂州市', '荆门市', '孝感市', '荆州市', '黄冈市', '咸宁市', '随州市'].map((city) => [city, '湖北省']),
  ...['长沙市', '株洲市', '湘潭市', '衡阳市', '邵阳市', '岳阳市', '常德市', '张家界市', '益阳市', '郴州市', '永州市', '怀化市', '娄底市'].map((city) => [city, '湖南省']),
  ...['成都市', '自贡市', '攀枝花市', '泸州市', '德阳市', '绵阳市', '广元市', '遂宁市', '内江市', '乐山市', '南充市', '眉山市', '宜宾市', '广安市', '达州市', '雅安市', '巴中市', '资阳市'].map((city) => [city, '四川省']),
  ...['贵阳市', '六盘水市', '遵义市', '安顺市', '毕节市', '铜仁市'].map((city) => [city, '贵州省']),
  ...['昆明市', '曲靖市', '玉溪市', '保山市', '昭通市', '丽江市', '普洱市', '临沧市'].map((city) => [city, '云南省']),
  ...['西安市', '铜川市', '宝鸡市', '咸阳市', '渭南市', '延安市', '汉中市', '榆林市', '安康市', '商洛市'].map((city) => [city, '陕西省']),
  ...['兰州市', '嘉峪关市', '金昌市', '白银市', '天水市', '武威市', '张掖市', '平凉市', '酒泉市', '庆阳市', '定西市', '陇南市'].map((city) => [city, '甘肃省']),
  ...['西宁市', '海东市'].map((city) => [city, '青海省']),
]);

const CITY_SUFFIXES = new Set(['市', '州', '盟', '地区']);

function compact(value) {
  return String(value || '').replace(/\s+/g, '').replace(/[／]/g, '/');
}

function normalizeCityText(value) {
  const text = compact(value);
  if (!text) return '';
  return text.replace(/^.*?[/|,，;；]/, '').replace(/人民政府$/, '').trim();
}

export function normalizeProvince(value) {
  const text = compact(value);
  if (!text) return '';
  if (/(全国|国家层面|全国范围)/.test(text)) return '全国';
  for (const [full, aliases] of PROVINCE_DEFINITIONS) {
    if (aliases.some((alias) => text === alias || text.startsWith(alias) || text.includes(alias))) return full;
  }
  return '';
}

export function normalizeCity(value, province = '') {
  const text = normalizeCityText(value);
  if (!text) return '';
  const embeddedProvince = normalizeProvince(text);
  if (embeddedProvince && !MUNICIPALITIES.has(embeddedProvince) && !/市/.test(text)) return '';
  const normalizedProvince = normalizeProvince(text);
  if (normalizedProvince && !/市/.test(text) && !/[州盟]|地区$/.test(text)) {
    return MUNICIPALITIES.has(normalizedProvince) ? normalizedProvince : '';
  }

  let city = text;
  for (const [, aliases] of PROVINCE_DEFINITIONS) {
    for (const alias of aliases) {
      if (city.startsWith(alias)) {
        city = city.slice(alias.length);
        break;
      }
    }
    if (city !== text) break;
  }
  city = city.replace(/^(省|市|自治区|特别行政区)/, '').trim();
  const match = city.match(/([\u4e00-\u9fff]{2,6}?市)/)
    || city.match(/([\u4e00-\u9fff]{2,8}?州)/)
    || city.match(/([\u4e00-\u9fff]{2,8}?盟)/)
    || city.match(/([\u4e00-\u9fff]{2,8}?地区)/);
  if (match) city = match[1];
  city = city.replace(/(?:人民政府|委员会|商务局|财政局|发展改革委|发展和改革委员会|人民政府办公室).*$/, '');
  if (!city || city === province) return MUNICIPALITIES.has(province) ? province : '';
  if (city.length < 2 || !/[市州盟]|地区$/.test(city)) return '';
  if (/(省|自治区|特别行政区|中国|全国|财政|政府|委员会|商务|发展改革|通知|公告|政策|补贴|试点|全区|全省|全市)/.test(city)) return '';
  if (CITY_PROVINCE.has(city) && province && CITY_PROVINCE.get(city) !== province) return '';
  return city;
}

export function normalizeDistrict(value) {
  let text = compact(value);
  if (!text) return '';
  for (const [, aliases] of PROVINCE_DEFINITIONS) {
    for (const alias of aliases) {
      if (text.startsWith(alias)) {
        text = text.slice(alias.length);
        break;
      }
    }
    if (!text) break;
  }
  const match = text.match(/([\u4e00-\u9fff]{1,12}(?:区|县|旗|市))/);
  let district = (match?.[1] || text).trim().replace(/^.*?市/, '');
  if (!district || /(省|自治区|特别行政区|中国|全国|财政|政府|委员会|商务|发展改革|通知|公告|政策|补贴|换新|专区|首页|栏目|全区|试点)/.test(district)) return '';
  return district;
}

function inferProvinceFromUrl(sourceUrl) {
  const url = compact(sourceUrl).toLowerCase();
  if (!url) return '';
  const rules = [
    ['beijing', '北京市'], ['bj.gov.cn', '北京市'], ['tianjin', '天津市'], ['tj.gov.cn', '天津市'],
    ['hebei', '河北省'], ['shanxi', '山西省'], ['nmg', '内蒙古自治区'], ['liaoning', '辽宁省'],
    ['jilin', '吉林省'], ['hlj', '黑龙江省'], ['shanghai', '上海市'], ['jiangsu', '江苏省'],
    ['zhejiang', '浙江省'], ['anhui', '安徽省'], ['fujian', '福建省'], ['jiangxi', '江西省'],
    ['shandong', '山东省'], ['henan', '河南省'], ['hubei', '湖北省'], ['hunan', '湖南省'],
    ['guangdong', '广东省'], ['guangxi', '广西壮族自治区'], ['hainan', '海南省'], ['chongqing', '重庆市'],
    ['sichuan', '四川省'], ['guizhou', '贵州省'], ['yunnan', '云南省'], ['xizang', '西藏自治区'],
    ['shaanxi', '陕西省'], ['gansu', '甘肃省'], ['qinghai', '青海省'], ['ningxia', '宁夏回族自治区'],
    ['xinjiang', '新疆维吾尔自治区'],
  ];
  for (const [key, province] of rules) if (url.includes(key)) return province;
  return '';
}

function inferCityFromText(text, province = '') {
  const value = compact(text);
  if (!value) return '';
  const matches = [...value.matchAll(/([\u4e00-\u9fff]{2,8}(?:市|州|盟|地区))/g)].map((match) => match[1]);
  for (const candidate of matches) {
    if (/(全区|全省|全市|试点|人民政府|商务厅|财政厅|商务局|财政局)/.test(candidate)) continue;
    const candidateProvince = normalizeProvince(candidate);
    if (candidateProvince && !MUNICIPALITIES.has(candidateProvince)) continue;
    const city = normalizeCity(candidate, province);
    if (!city) continue;
    if (CITY_PROVINCE.has(city) && CITY_PROVINCE.get(city) !== province) continue;
    return city;
  }
  return '';
}

function inferDistrictFromText(text, city = '', province = '') {
  const value = compact(text);
  if (!value) return '';
  const matches = [...value.matchAll(/([\u4e00-\u9fff]{1,12}(?:新区|区|县|旗))/g)].map((match) => match[1]);
  for (const candidate of matches) {
    const district = normalizeDistrict(candidate);
    if (!district) continue;
    if (province && district === province) continue;
    if (city && district === city) continue;
    return district;
  }
  return '';
}

export function inferGeo({ jurisdictionName = '', city = '', district = '', title = '', sourceUrl = '' } = {}) {
  const explicitName = compact(jurisdictionName);
  const combined = [explicitName, title, sourceUrl].filter(Boolean).join(' ');
  let province = normalizeProvince(explicitName) || normalizeProvince(city) || normalizeProvince(combined) || inferProvinceFromUrl(sourceUrl);
  let normalizedCity = normalizeCity(city, province) || normalizeCity(explicitName, province);

  if (!province && normalizedCity && CITY_PROVINCE.has(normalizedCity)) province = CITY_PROVINCE.get(normalizedCity);
  if (!normalizedCity && province) normalizedCity = inferCityFromText(combined, province);
  if (MUNICIPALITIES.has(province)) normalizedCity = province;
  if (province === '全国') {
    normalizedCity = '';
    return { province, city: '', district: '' };
  }

  let normalizedDistrict = normalizeDistrict(district);
  if (!normalizedDistrict) normalizedDistrict = inferDistrictFromText(combined, normalizedCity, province);
  if (normalizedDistrict && normalizedCity && normalizedDistrict === normalizedCity) normalizedDistrict = '';
  return { province, city: normalizedCity, district: normalizedDistrict };
}

export function isMunicipality(value) {
  return MUNICIPALITIES.has(normalizeProvince(value));
}
