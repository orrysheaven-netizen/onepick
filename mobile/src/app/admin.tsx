import { useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Product = { id: string; name: string; brand: string; category: string; status: '대기' | '승인' | '반려'; note: string };
type Report = { id: string; target: string; content: string; reason: string; status: '미처리' | '숨김' | '기각' };
type Section = '제품 검토' | '신고 관리' | '카테고리' | '처리 이력';
const initialProducts: Product[] = [
  { id: 'P-001', name: '데일리 토트백', brand: 'ONE STUDIO', category: '패션', status: '대기', note: '' },
  { id: 'P-002', name: '오트밀 머그', brand: 'MORNING CLUB', category: '리빙', status: '대기', note: '' },
  { id: 'P-003', name: '라이트 글로우 크림', brand: 'LUMI', category: '뷰티', status: '대기', note: '' },
  { id: 'P-004', name: '노이즈 캔슬링 헤드폰', brand: 'SONA', category: '테크', status: '승인', note: '예시 승인 제품' },
];
const initialReports: Report[] = [
  { id: 'R-001', target: '토트백 Pick의 댓글', content: '제품과 관련 없는 홍보 링크를 반복 게시한 예시 댓글입니다.', reason: '광고·스팸', status: '미처리' },
  { id: 'R-002', target: '머그 Pick의 한줄평', content: '제품을 사용한 경험이 없는 것으로 신고된 예시 한줄평입니다.', reason: '부정확한 정보', status: '미처리' },
];

function Action({ children, onPress, subtle = false, disabled = false }: { children: string; onPress: () => void; subtle?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, subtle && s.secondary, (pressed || disabled) && { opacity: 0.45 }]}><Text style={[s.buttonText, subtle && { color: '#334155' }]}>{children}</Text></Pressable>;
}
function Badge({ text }: { text: string }) {
  const good = ['승인', '활성', '기각'].includes(text);
  return <View style={[s.badge, { backgroundColor: good ? '#E6F4EC' : '#FFF0DB' }]}><Text style={{ color: good ? '#24704B' : '#985C13', fontSize: 12, fontWeight: '700' }}>{text}</Text></View>;
}

export default function AdminScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const [section, setSection] = useState<Section>('제품 검토');
  const [products, setProducts] = useState(initialProducts);
  const [reports, setReports] = useState(initialReports);
  const [categories, setCategories] = useState(['패션', '뷰티', '리빙', '테크'].map(name => ({ name, active: true })));
  const [history, setHistory] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('대기');
  const [selected, setSelected] = useState('P-001');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const product = products.find(item => item.id === selected);
  const record = (text: string) => {
    setHistory(items => [`${new Date().toLocaleTimeString('ko-KR')} · ${text}`, ...items]);
    setMessage(text); setError('');
  };
  const review = (status: '승인' | '반려') => {
    if (!product || product.status !== '대기') return;
    if (status === '반려' && !reason.trim()) { setError('반려 사유를 입력해 주세요.'); return; }
    setProducts(items => items.map(item => item.id === selected ? { ...item, status, note: reason.trim() } : item));
    record(`${product.name} ${status}${reason.trim() ? ` · ${reason.trim()}` : ''}`); setReason('');
  };
  const resolveReport = (id: string, status: '숨김' | '기각') => {
    const report = reports.find(item => item.id === id);
    if (!report || report.status !== '미처리') return;
    if (!reason.trim()) { setError('처리 사유를 입력해 주세요.'); return; }
    setReports(items => items.map(item => item.id === id ? { ...item, status } : item));
    record(`${id} ${status} · ${reason.trim()}`); setReason('');
  };
  const switchSection = (value: Section) => { setSection(value); setReason(''); setError(''); setQuery(''); };
  const visible = products.filter(item => (filter === '전체' || item.status === filter) && `${item.name} ${item.brand} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()));

  return <SafeAreaView style={s.page}>
    <View style={[s.shell, wide && { flexDirection: 'row' }]}>
      <View style={[s.sidebar, wide && { width: 224 }]}>
        <Text style={s.brand}>OnePick<Text style={{ color: '#F09B79' }}> / </Text></Text>
        <Text style={s.sideCaption}>운영 관리</Text>
        <View style={{ flexDirection: wide ? 'column' : 'row', flexWrap: 'wrap', gap: 8, marginTop: 28 }}>
          {(['제품 검토', '신고 관리', '카테고리', '처리 이력'] as Section[]).map((item, index) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: section === item }} onPress={() => switchSection(item)} style={[s.nav, section === item && { backgroundColor: '#334155' }]}><Text style={{ color: section === item ? '#FFFFFF' : '#B5C0D1', fontWeight: '600' }}>{`0${index + 1}   ${item}`}</Text></Pressable>)}
        </View>
        <Link href="/" style={s.back}>← 사용자 화면으로</Link>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.main, !wide && { padding: 18 }]}>
        <View style={s.headingRow}><View><Text style={s.eyebrow}>WORKSPACE / ONEPICK</Text><Text style={s.title}>운영 대시보드</Text></View><Badge text="데모" /></View>
        <Text style={s.notice}>예시 데이터로 운영 흐름을 확인하는 화면입니다. 변경은 새로고침하면 초기화되며 실제 서비스에 반영되지 않습니다. 관리자 로그인은 아직 연결되지 않았습니다.</Text>
        <View style={s.stats}>{[['승인 대기', products.filter(p => p.status === '대기').length], ['미처리 신고', reports.filter(r => r.status === '미처리').length], ['활성 카테고리', categories.filter(c => c.active).length], ['이번 세션 처리', history.length]].map(([label, value]) => <View key={label} style={s.stat}><Text style={s.muted}>{label}</Text><Text style={s.number}>{value}<Text style={s.unit}> 건</Text></Text></View>)}</View>
        {!!message && <Text accessibilityLiveRegion="polite" style={s.feedback}>{message}</Text>}
        <Text style={s.sectionTitle}>{section}</Text>
        {section === '제품 검토' && <>
          <View style={s.toolbar}><TextInput accessibilityLabel="제품 검색" placeholder="제품명, 브랜드, 관리번호 검색" value={query} onChangeText={setQuery} style={[s.input, { flex: 1, minWidth: 180 }]} /><View style={s.row}>{['대기', '승인', '반려', '전체'].map(value => <Action key={value} subtle={filter !== value} onPress={() => setFilter(value)}>{value}</Action>)}</View></View>
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: 20, alignItems: 'stretch' }}>
            <View style={[s.panel, { flex: 1.4 }]}><Text style={s.panelTitle}>등록 제품 · {visible.length}</Text>
              {visible.length === 0 && <Text style={s.empty}>조건에 맞는 제품이 없습니다.</Text>}
              {visible.map(item => <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 검토`} key={item.id} onPress={() => { setSelected(item.id); setReason(''); setError(''); }} style={[s.item, selected === item.id && { backgroundColor: '#FFF6F0', borderColor: '#EDBC9F' }]}><View style={{ flex: 1 }}><Text style={s.muted}>{item.id} · {item.category}</Text><Text style={s.itemTitle}>{item.name}</Text><Text style={s.muted}>{item.brand}</Text></View><Badge text={item.status} /></Pressable>)}
            </View>
            <View style={[s.panel, { flex: 1 }]}><Text style={s.panelTitle}>제품 검토 상세</Text>{product && <><Text style={s.itemTitle}>{product.name}</Text><Text style={s.muted}>{product.brand} · {product.category} · {product.id}</Text><View style={s.preview}><Text style={{ fontSize: 34 }}>◇</Text><Text style={s.muted}>제품 이미지 예시 영역</Text></View><Badge text={product.status} />{product.status === '대기' ? <><Text style={s.label}>검토 메모 · 반려 시 필수</Text><TextInput accessibilityLabel="검토 메모" multiline value={reason} onChangeText={setReason} placeholder="제품 정보 확인 결과를 입력하세요" style={[s.input, { minHeight: 90 }]} />{!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}<View style={[s.row, { marginTop: 16 }]}><Action onPress={() => review('승인')}>승인하기</Action><Action subtle onPress={() => review('반려')}>반려하기</Action></View></> : <Text style={s.notice}>{product.note || '검토 완료된 제품입니다.'}</Text>}</>}</View>
          </View>
        </>}
        {section === '신고 관리' && <View style={s.panel}><Text style={s.panelTitle}>신고 검토</Text><Text style={s.muted}>내용을 확인한 뒤 처리 사유를 남겨주세요. 숨김은 이 데모의 신고 상태만 변경합니다.</Text><TextInput accessibilityLabel="신고 처리 사유" value={reason} onChangeText={setReason} placeholder="처리 사유 (필수)" style={[s.input, { marginVertical: 16 }]} />{!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}{reports.map(report => <View key={report.id} style={s.report}><View style={s.headingRow}><Text style={s.itemTitle}>{report.target}</Text><Badge text={report.status} /></View><Text style={s.muted}>{report.id} · {report.reason}</Text><Text style={s.quote}>{report.content}</Text><View style={s.row}><Action disabled={report.status !== '미처리'} onPress={() => resolveReport(report.id, '숨김')}>콘텐츠 숨김</Action><Action disabled={report.status !== '미처리'} subtle onPress={() => resolveReport(report.id, '기각')}>신고 기각</Action></View></View>)}</View>}
        {section === '카테고리' && <View style={s.panel}><Text style={s.panelTitle}>카테고리 관리</Text><View style={s.toolbar}><TextInput accessibilityLabel="새 카테고리 이름" maxLength={30} value={newCategory} onChangeText={setNewCategory} placeholder="새 카테고리 이름" style={[s.input, { flex: 1 }]} /><Action onPress={() => { const name = newCategory.trim(); if (!name || categories.some(c => c.name.toLowerCase() === name.toLowerCase())) { setError('비어 있거나 중복된 이름은 추가할 수 없습니다.'); return; } setCategories(items => [...items, { name, active: true }]); record(`${name} 카테고리 추가`); setNewCategory(''); }}>추가</Action></View>{!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}{categories.map(category => <View style={s.item} key={category.name}><Text style={[s.itemTitle, { flex: 1 }]}>{category.name}</Text><Badge text={category.active ? '활성' : '비활성'} /><Action subtle onPress={() => { setCategories(items => items.map(c => c.name === category.name ? { ...c, active: !c.active } : c)); record(`${category.name} ${category.active ? '비활성화' : '활성화'}`); }}>{category.active ? '비활성화' : '활성화'}</Action></View>)}</View>}
        {section === '처리 이력' && <View style={s.panel}><Text style={s.panelTitle}>이번 세션의 처리 기록</Text><Text style={s.muted}>새로고침하면 기록이 초기화됩니다.</Text>{history.length === 0 ? <Text style={s.empty}>아직 처리한 항목이 없습니다.</Text> : history.map((entry, index) => <Text key={`${index}-${entry}`} style={s.quote}>{entry}</Text>)}</View>}
      </ScrollView>
    </View>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F4F6F9' }, shell: { flex: 1 }, sidebar: { backgroundColor: '#1B2637', padding: 24 }, brand: { color: 'white', fontSize: 27, fontWeight: '800', letterSpacing: -1 }, sideCaption: { color: '#96A6BC', marginTop: 8, fontSize: 13 }, nav: { padding: 14, borderRadius: 9 }, back: { color: '#BAC7D8', marginTop: 32, fontSize: 13 },
  main: { padding: 34, gap: 20, maxWidth: 1450, width: '100%', alignSelf: 'center', paddingBottom: 60 }, headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, eyebrow: { fontSize: 11, letterSpacing: 2, color: '#79869A', fontWeight: '700' }, title: { fontSize: 30, fontWeight: '800', color: '#1D293B', marginTop: 8 }, notice: { color: '#745C37', backgroundColor: '#FFF6E6', padding: 15, borderRadius: 10, fontSize: 13, lineHeight: 21, marginTop: 12 }, stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, stat: { flex: 1, minWidth: 140, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E7ED', padding: 20 }, number: { fontSize: 32, color: '#1D293B', fontWeight: '800', marginTop: 12 }, unit: { fontSize: 12, color: '#8A96A5' }, muted: { color: '#69788C', fontSize: 12, lineHeight: 20 }, sectionTitle: { color: '#263449', fontSize: 21, fontWeight: '700' }, toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, panel: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E7ED', borderRadius: 14, padding: 20 }, panelTitle: { fontSize: 15, color: '#25334A', fontWeight: '700', marginBottom: 18 }, item: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, borderWidth: 1, borderColor: '#EBEEF3', borderRadius: 10, padding: 16, marginVertical: 5 }, itemTitle: { color: '#263449', fontSize: 15, fontWeight: '700', marginVertical: 5 }, badge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }, button: { backgroundColor: '#C66A45', paddingVertical: 11, paddingHorizontal: 16, borderRadius: 8 }, secondary: { backgroundColor: '#EEF1F5' }, buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 }, input: { borderWidth: 1, borderColor: '#CBD3DE', backgroundColor: '#FFFFFF', borderRadius: 8, padding: 12, color: '#1D293B', fontSize: 14 }, label: { marginTop: 22, marginBottom: 10, fontSize: 13, color: '#475569' }, preview: { backgroundColor: '#F5F2EE', alignItems: 'center', justifyContent: 'center', height: 110, borderRadius: 10, marginVertical: 20 }, error: { color: '#AD3434', marginTop: 10, fontSize: 13 }, feedback: { color: '#216147', backgroundColor: '#E7F4EE', borderRadius: 8, padding: 12 }, empty: { color: '#79869A', paddingVertical: 38, textAlign: 'center' }, report: { paddingVertical: 20, borderTopWidth: 1, borderColor: '#EDF0F4' }, quote: { padding: 16, marginVertical: 12, backgroundColor: '#F5F7FA', borderRadius: 8, color: '#46556B', lineHeight: 22, fontSize: 13 },
});
