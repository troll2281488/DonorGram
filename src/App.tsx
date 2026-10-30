import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Archive, Bell, Check, CheckCheck, ChevronDown, CircleHelp,
  Compass, Copy, Hash, Image, MapPin, Menu, MessageCircle, MoreHorizontal,
  Paperclip, Phone, Plus, Search, Send, Settings, ShieldCheck, Sparkles,
  Users, Video, Wifi, X, Zap
} from "lucide-react";
import {
  createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword,
  signOut, updateProfile
} from "firebase/auth";
import type { User } from "firebase/auth";
import {
  addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp,
  setDoc, where, limit, getDocs, startAt, endAt, orderBy as orderByField
} from "firebase/firestore";
import { auth, db, firebaseReady } from "./firebase";

type ChatMessage = {
  id: string; text: string; uid: string; displayName: string;
  createdAt?: { toDate?: () => Date } | null;
};
type ChatRoom = { id: string; name: string; type: "direct" | "group"; members: string[]; lastMessage?: string };
type LocalMessage = ChatMessage & { local?: boolean };

const DEMO_ROOMS: ChatRoom[] = [
  { id: "lobby", name: "Nova Lounge", type: "group", members: ["demo"], lastMessage: "Добро пожаловать в Nova ✨" },
  { id: "ideas", name: "Идеи и планы", type: "group", members: ["demo"], lastMessage: "Обсуждаем новое" },
  { id: "notes", name: "Заметки себе", type: "direct", members: ["demo"], lastMessage: "Твои быстрые заметки" },
];
const DEMO_MESSAGES: Record<string, LocalMessage[]> = {
  lobby: [
    { id: "m1", uid: "system", displayName: "Nova Guide", text: "Добро пожаловать! Это локальный предпросмотр — подключи Firebase, чтобы общаться между устройствами.", local: true },
    { id: "m2", uid: "system", displayName: "Nova Guide", text: "Совет: текстовые сообщения, реакции и статусы обычно гораздо экономнее трафика, чем медиа.", local: true },
  ],
  ideas: [{ id: "m3", uid: "system", displayName: "Nova Guide", text: "Здесь можно планировать идеи. В демо сообщения сохраняются только в текущем сеансе.", local: true }],
  notes: [{ id: "m4", uid: "demo", displayName: "Ты", text: "Личное пространство для быстрых мыслей.", local: true }],
};

const initials = (s: string) => s.trim().split(/\s+/).slice(0, 2).map(x => x[0] || "").join("").toUpperCase() || "N";
const timeLabel = (m: ChatMessage) => {
  try { return m.createdAt?.toDate?.().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) || "сейчас"; }
  catch { return "сейчас"; }
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [registerMode, setRegisterMode] = useState(false);
  const [activeId, setActiveId] = useState("lobby");
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [messages, setMessages] = useState<Record<string, LocalMessage[]>>({});
  const [draft, setDraft] = useState("");
  const [searchText, setSearchText] = useState("");
  const [notice, setNotice] = useState("Войди или создай аккаунт, чтобы открыть настоящий чат.");
  const [panel, setPanel] = useState<"none" | "ai" | "settings" | "newgroup" | "gps" | "calls">("none");
  const [groupName, setGroupName] = useState("");
  const [groupMemberEmails, setGroupMemberEmails] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userResults, setUserResults] = useState<{uid:string;displayName:string}[]>([]);
  const [userSearchBusy, setUserSearchBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [locationState, setLocationState] = useState<"off" | "loading" | "ready" | "error">("off");
  const [coords, setCoords] = useState<{lat:number; lng:number} | null>(null);
  const [compactMode, setCompactMode] = useState(false);
  const initializedRoomFor = useRef<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!db || !user) {
      initializedRoomFor.current = null;
      setRooms([]);
      setMessages({});
      setActiveId("");
      return;
    }
    const q = query(collection(db, "rooms"), where("members", "array-contains", user.uid), limit(80));
    return onSnapshot(q, async snap => {
      const next = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatRoom));
      setRooms(next);
      if (next.length) {
        setActiveId(current => next.some(r => r.id === current) ? current : next[0].id);
        initializedRoomFor.current = user.uid;
      } else if (initializedRoomFor.current !== user.uid) {
        initializedRoomFor.current = user.uid;
        try {
          const room = await addDoc(collection(db, "rooms"), {
            name: "Nova Lounge", type: "group", members: [user.uid],
            createdBy: user.uid, createdAt: serverTimestamp()
          });
          setActiveId(room.id);
        } catch {
          initializedRoomFor.current = null;
          setNotice("Не удалось создать первый чат. Проверь публикацию Firestore Rules в Firebase Console.");
        }
      }
    }, () => setNotice("Не удалось загрузить чаты. Проверь Firestore Rules и интернет."));
  }, [user]);

  useEffect(() => {
    if (!db || !user || !activeId || activeId === "lobby" || activeId === "ideas" || activeId === "notes") return;
    const q = query(collection(db, "rooms", activeId, "messages"), orderBy("createdAt", "asc"), limit(100));
    return onSnapshot(q, snap => {
      setMessages(prev => ({ ...prev, [activeId]: snap.docs.map(d => ({ id: d.id, ...d.data() } as LocalMessage)) }));
    }, () => setNotice("Не удалось загрузить сообщения этого чата."));
  }, [user, activeId]);

  const activeRoom = rooms.find(r => r.id === activeId) || (user ? { id: "loading", name: "Загрузка чатов…", type: "group" as const, members: [user.uid] } : { id: "guest", name: "Войди в аккаунт", type: "group" as const, members: [] });
  const activeMessages = user ? (messages[activeId] || []) : [];
  const filteredRooms = useMemo(() => rooms.filter(r => r.name.toLowerCase().includes(searchText.toLowerCase())), [rooms, searchText]);

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!auth || !firebaseReady) { setAuthError("Сначала подключи Firebase: скопируй .env.example в .env и заполни настройки проекта."); return; }
    setAuthBusy(true); setAuthError("");
    try {
      if (registerMode) {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (displayName.trim()) await updateProfile(cred.user, { displayName: displayName.trim() });
        await setDoc(doc(db!, "users", cred.user.uid), {
          uid: cred.user.uid, displayName: displayName.trim() || email.split("@")[0],
          email: email.trim().toLowerCase(), createdAt: serverTimestamp(), discoverable: true
        });
        await setDoc(doc(db!, "publicProfiles", cred.user.uid), { uid: cred.user.uid, displayName: displayName.trim() || email.split("@")[0], createdAt: serverTimestamp() });
        setNotice("Аккаунт создан. Твой профиль виден зарегистрированным пользователям по имени.");
      } else {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        await setDoc(doc(db!, "publicProfiles", cred.user.uid), { uid: cred.user.uid, displayName: cred.user.displayName || email.split("@")[0] }, { merge: true });
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Не удалось войти. Проверь данные.");
    } finally { setAuthBusy(false); }
  }

  async function searchUsers(e: React.FormEvent) {
    e.preventDefault();
    if (!db || !user || !userSearch.trim()) return;
    setUserSearchBusy(true); setUserResults([]);
    try {
      const term = userSearch.trim().toLocaleLowerCase();
      const q = query(collection(db, "publicProfiles"), orderByField("displayName"), startAt(term), endAt(term + "\\uf8ff"), limit(12));
      const snap = await getDocs(q);
      setUserResults(snap.docs.map(d => ({ uid: String(d.data().uid || d.id), displayName: String(d.data().displayName || "Пользователь") })).filter(p => p.uid !== user.uid));
      if (!snap.docs.length) setNotice("Пользователи с таким именем не найдены.");
    } catch { setNotice("Поиск не удался. Проверь публикацию Firestore Rules."); }
    finally { setUserSearchBusy(false); }
  }

  async function openDirectChat(other: {uid:string;displayName:string}) {
    if (!db || !user) return;
    const members = [user.uid, other.uid].sort();
    const roomId = "dm_" + members.join("_");
    try {
      await setDoc(doc(db, "rooms", roomId), { name: other.displayName, type: "direct", members, createdBy: user.uid, createdAt: serverTimestamp() }, { merge: true });
      setActiveId(roomId); setPanel("none"); setUserSearch(""); setUserResults([]);
      setNotice("Личный чат открыт. Теперь сообщения синхронизируются между участниками.");
    } catch { setNotice("Не удалось открыть чат. Проверь правила Firestore."); }
  }

  async function sendMessage(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (!user || !db || !activeId || activeId === "loading" || activeId === "guest") {
      setNotice("Чтобы отправлять настоящие сообщения, войди в аккаунт и дождись загрузки чатов.");
      return;
    }
    const optimistic: LocalMessage = {
      id: `local-${Date.now()}`, text, uid: user?.uid || "demo",
      displayName: user?.displayName || "Ты", local: true
    };
    setMessages(prev => ({ ...prev, [activeId]: [...(prev[activeId] || []), optimistic] }));
    setDraft("");
    if (db && user && !["lobby", "ideas", "notes", "loading", "guest"].includes(activeId)) {
      try {
        await addDoc(collection(db, "rooms", activeId, "messages"), {
          text, uid: user.uid, displayName: user.displayName || user.email || "Пользователь",
          createdAt: serverTimestamp(), type: "text"
        });
        setMessages(prev => ({ ...prev, [activeId]: (prev[activeId] || []).filter(m => m.id !== optimistic.id) }));
      } catch {
        setNotice("Сообщение оставлено в интерфейсе, но не доставлено. Проверь правила Firebase.");
      }
    } else {
      setMessages(prev => ({ ...prev, [activeId]: (prev[activeId] || []).filter(m => m.id !== optimistic.id) }));
      setNotice("Сообщение не отправлено: выбери настоящий чат после входа в аккаунт.");
    }
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) return;
    if (!db || !user) {
      const id = `local-${Date.now()}`;
      setRooms(prev => [{ id, name: groupName.trim(), type: "group", members: ["demo"] }, ...prev]);
      setMessages(prev => ({ ...prev, [id]: [] }));
      setActiveId(id); setGroupName(""); setPanel("none");
      setNotice("Локальная группа создана только для предпросмотра.");
      return;
    }
    try {
      const ref = await addDoc(collection(db, "rooms"), {
        name: groupName.trim(), type: "group", members: [user.uid],
        createdBy: user.uid, createdAt: serverTimestamp()
      });
      setActiveId(ref.id); setGroupName(""); setGroupMemberEmails(""); setPanel("none");
    } catch { setNotice("Не удалось создать группу. Проверь Firestore Rules."); }
  }

  function askAi(e: React.FormEvent) {
    e.preventDefault();
    const p = aiPrompt.trim();
    if (!p) return;
    setAiAnswer(`DonAI · локальный режим\n\nЯ получил запрос: «${p}»\n\nЭто демонстрационная заглушка: для настоящих ответов подключи серверную Cloud Function с выбранной AI-моделью. Не храни секретный API-ключ в браузере. Сервер должен проверять авторизацию и ограничивать частоту запросов.`);
  }

  function shareLocation() {
    if (!navigator.geolocation) { setLocationState("error"); return; }
    setLocationState("loading");
    navigator.geolocation.getCurrentPosition(
      pos => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocationState("ready"); },
      () => setLocationState("error"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 }
    );
  }

  const isLoggedIn = Boolean(user);
  return (
    <div className={`app ${compactMode ? "compact" : ""}`}>
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><Zap size={22} fill="currentColor" /></div>
          <div><div className="brand-name">DonorGram <span>Nova</span></div><div className="brand-sub">пространство для своих</div></div>
          <button className="icon-btn mobile-only" aria-label="Закрыть меню" onClick={() => setSidebarOpen(false)}><X size={18}/></button>
        </div>
        <div className="account-card">
          <div className="avatar self">{initials(user?.displayName || "Nova User")}</div>
          <div className="account-copy"><strong>{user?.displayName || "Гость Nova"}</strong><span><i className={`status-dot ${isLoggedIn ? "online" : ""}`}/>{isLoggedIn ? "Аккаунт подключён" : "Не выполнен вход"}</span></div>
          <button className="icon-btn" aria-label="Настройки" onClick={() => setPanel("settings")}><Settings size={17}/></button>
        </div>
        {!isLoggedIn && <div className="auth-mini">
          <div className="auth-heading">{registerMode ? "Создать аккаунт" : "Войти в Nova"}</div>
          <form onSubmit={submitAuth}>
            {registerMode && <input aria-label="Имя" placeholder="Как тебя называть" value={displayName} onChange={e=>setDisplayName(e.target.value)} maxLength={40}/>}
            <input aria-label="Email" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/>
            <input aria-label="Пароль" type="password" placeholder="Пароль (от 6 символов)" value={password} onChange={e=>setPassword(e.target.value)} minLength={6} required/>
            <button className="primary-btn auth-btn" disabled={authBusy}>{authBusy ? "Подождите…" : registerMode ? "Зарегистрироваться" : "Войти"}</button>
          </form>
          <button className="link-btn" onClick={()=>{setRegisterMode(!registerMode);setAuthError("");}}>{registerMode ? "Уже есть аккаунт? Войти" : "Новый пользователь? Создать"}</button>
          {authError && <p className="error-text">{authError}</p>}
          {!firebaseReady && <p className="tiny-note">Firebase пока не подключён</p>}
        </div>}
        <div className="section-label"><span>РАБОЧЕЕ ПРОСТРАНСТВО</span><button className="icon-btn small" aria-label="Создать чат" onClick={()=>setPanel("newgroup")}><Plus size={16}/></button></div>
        <div className="search-wrap"><Search size={16}/><input aria-label="Поиск чатов" placeholder="Найти чат..." value={searchText} onChange={e=>setSearchText(e.target.value)}/><kbd>⌘ K</kbd></div>
        <div className="nav-list">
          <button className="nav-item" onClick={()=>setPanel("ai")}><span className="nav-icon ai-icon"><Sparkles size={17}/></span><span>DonAI помощник</span><span className="nav-pill">AI</span></button>
          <button className="nav-item" onClick={()=>setPanel("gps")}><span className="nav-icon"><Compass size={17}/></span><span>Моя геопозиция</span></button>
          <button className="nav-item" onClick={()=>setPanel("calls")}><span className="nav-icon"><Phone size={17}/></span><span>Звонки</span><span className="nav-muted">WebRTC</span></button>
        </div>
        <div className="section-label chats-label"><span>ЧАТЫ <span className="count">{filteredRooms.length}</span></span><button className="icon-btn small" aria-label="Новая группа" onClick={()=>setPanel("newgroup")}><Plus size={16}/></button></div>
        <div className="chat-list">
          {filteredRooms.map((r, i)=><button key={r.id} className={`chat-item ${activeId===r.id?"active":""}`} onClick={()=>{setActiveId(r.id);setSidebarOpen(false);}}>
            <div className={`avatar ${i===0?"avatar-purple":i===1?"avatar-coral":"avatar-blue"}`}>{r.type==="group"?<Users size={18}/>:initials(r.name)}</div>
            <div className="chat-item-copy"><strong>{r.name}</strong><span>{r.lastMessage || (r.type==="group"?"Групповой чат":"Личные заметки")}</span></div>
            {activeId===r.id && <span className="active-indicator"/>}
          </button>)}
          {filteredRooms.length===0 && <div className="empty-small">Ничего не найдено</div>}
        </div>
        <div className="sidebar-bottom">
          <div className="traffic-card"><div className="traffic-icon"><Activity size={16}/></div><div><strong>Экономия трафика</strong><span>Текст первым · медиа по запросу</span></div><CheckCircleMini/></div>
          <div className="sidebar-foot"><span><span className="pulse"/> {user ? "Аккаунт подключён" : "Требуется вход"}</span><button className="icon-btn" aria-label="Помощь" onClick={()=>setNotice("Nova — стартовый проект. См. README.md для подключения и развёртывания.")}><CircleHelp size={16}/></button></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-btn mobile-only" aria-label="Открыть меню" onClick={()=>setSidebarOpen(true)}><Menu size={19}/></button><div className="breadcrumb"><span>Сообщения</span><span className="crumb-slash">/</span><strong>{activeRoom.name}</strong></div></div>
          <div className="topbar-actions"><div className="secure-label"><ShieldCheck size={15}/> <span>Приватность в приоритете</span></div><button className="icon-btn" aria-label="Уведомления" onClick={()=>setNotice("Уведомления подключаются отдельно через Firebase Cloud Messaging.")}><Bell size={18}/></button><button className="avatar top-avatar" aria-label="Открыть профиль" onClick={()=>setPanel("settings")}>{initials(user?.displayName || "N")}</button></div>
        </header>
        <div className="channel-header">
          <div className="channel-avatar"><Hash size={23}/></div>
          <div className="channel-title"><h1>{activeRoom.name}</h1><p>{activeRoom.type==="group"?"Групповое пространство":"Личное пространство"} <span className="bullet">·</span> {activeMessages.length} сообщений в загруженной истории</p></div>
          <div className="channel-tools"><button className="tool-btn" onClick={()=>setPanel("calls")}><Phone size={17}/><span>Аудио</span></button><button className="tool-btn" onClick={()=>setPanel("calls")}><Video size={17}/><span>Видео</span></button><button className="icon-btn" aria-label="Ещё" onClick={()=>setPanel("settings")}><MoreHorizontal size={20}/></button></div>
        </div>
        <div className="notice-strip"><span className="notice-dot"/><span>{notice}</span><button aria-label="Скрыть уведомление" onClick={()=>setNotice("")}><X size={14}/></button></div>
        <section className="message-area">
          <div className="day-divider"><span>НАЧАЛО ПРОСТРАНСТВА</span></div>
          {activeMessages.map((m, idx)=><div className={`message-row ${m.uid===user?.uid?"own-message":""}`} key={m.id}>
            <div className={`avatar message-avatar ${m.uid==="system"?"avatar-purple":""}`}>{initials(m.displayName)}</div>
            <div className="message-body"><div className="message-meta"><strong>{m.displayName}</strong><span>{timeLabel(m)}</span>{m.uid===user?.uid&&<CheckCheck size={14} className="read-check"/>}</div><div className="message-bubble">{m.text}</div><div className="message-hover-actions"><button aria-label="Копировать сообщение" onClick={()=>{void navigator.clipboard?.writeText(m.text);setNotice("Текст сообщения скопирован, если браузер разрешил доступ.");}}><Copy size={13}/></button><button aria-label="Ответить" onClick={()=>setDraft(`↪ ${m.displayName}: `)}><MessageCircle size={13}/></button></div></div>
          </div>)}
          {activeMessages.length===0 && <div className="empty-state"><div className="empty-illustration"><MessageCircle size={28}/></div><h3>Начни разговор</h3><p>Здесь пока тихо. Отправь первое сообщение — короткое и по делу.</p></div>}
          <div className="end-spacer"/>
        </section>
        <form className="composer" onSubmit={sendMessage}>
          <div className="composer-toolbar"><div className="composer-tools"><button type="button" className="composer-tool" aria-label="Прикрепить файл" onClick={()=>setNotice("Загрузка медиа намеренно не включена в стартовый каркас: добавь Storage с лимитами размера и проверкой типа файла.")}><Paperclip size={17}/></button><button type="button" className="composer-tool" aria-label="Добавить изображение" onClick={()=>setNotice("Изображения будут загружаться по запросу после подключения Firebase Storage.")}><Image size={17}/></button><span className="tool-divider"/><button type="button" className="composer-tool" onClick={()=>setPanel("ai")}><Sparkles size={16}/><span>Спросить DonAI</span></button></div><span className="composer-hint">Enter — отправить</span></div>
          <textarea aria-label="Текст сообщения" placeholder={user ? `Написать в ${activeRoom.name}...` : "Войди в аккаунт, чтобы переписываться"} value={draft} onChange={e=>setDraft(e.target.value)} disabled={!user || activeRoom.id === "loading"} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void sendMessage();}}} rows={2} maxLength={4000}/>
          <div className="composer-bottom"><div className="composer-status"><span className="status-lock"><ShieldCheck size={13}/></span><span>Сообщения до 4 000 символов</span></div><div className="composer-submit"><span className="char-count">{draft.length}/4000</span><button type="submit" className="send-btn" disabled={!user || activeRoom.id === "loading" || !draft.trim()}><span>Отправить</span><Send size={15}/></button></div></div>
        </form>
        <footer className="main-footer"><span>DONORGRAM NOVA <span className="footer-dot">•</span> BUILD 0.1</span><span><Wifi size={12}/> {firebaseReady ? "Состояние Firebase зависит от сети" : "Локальный режим"} <span className="footer-dot">•</span> Сделано для общения</span></footer>
      </main>

      {panel!=="none" && <div className="panel-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setPanel("none");}}>
        <section className="side-panel" role="dialog" aria-modal="true">
          <div className="panel-head"><div><span className="panel-eyebrow">DONORGRAM NOVA</span><h2>{panel==="ai"?"DonAI помощник":panel==="settings"?"Настройки":panel==="newgroup"?"Новое пространство":panel==="gps"?"Геопозиция":"Звонки"}</h2></div><button className="icon-btn" aria-label="Закрыть" onClick={()=>setPanel("none")}><X size={18}/></button></div>
          {panel==="ai" && <div className="panel-content"><div className="ai-hero"><div className="ai-orb"><Sparkles size={26}/></div><h3>DonAI</h3><p>Помощник для черновиков, идей и кратких пересказов.</p><span className="mode-chip">ДЕМО · БЕЗ API</span></div><div className="ai-response">{aiAnswer || "Привет! Я пока работаю в режиме демонстрации. Настоящий ИИ подключается через серверную функцию, чтобы секретный ключ не попадал в браузер."}</div><form className="panel-form" onSubmit={askAi}><label htmlFor="ai-prompt">Что нужно сделать?</label><textarea id="ai-prompt" rows={3} value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="Например: сократи этот текст до 3 пунктов..." maxLength={2000}/><button className="primary-btn"><Sparkles size={16}/> Подготовить запрос</button></form><p className="panel-footnote">Не отправляй пароли, платёжные данные или личные секреты в ИИ.</p></div>}
          {panel==="settings" && <div className="panel-content"><div className="settings-profile"><div className="avatar profile-big">{initials(user?.displayName || "Nova")}</div><div><h3>{user?.displayName || "Гость Nova"}</h3><p>{user?.email || "Аккаунт не подключён"}</p></div></div><div className="settings-row"><div><strong>Компактный интерфейс</strong><span>Больше сообщений на экране</span></div><button className={`toggle ${compactMode?"on":""}`} role="switch" aria-checked={compactMode} onClick={()=>setCompactMode(v=>!v)}><span/></button></div><div className="settings-row"><div><strong>Экономный режим</strong><span>Не загружать медиа автоматически</span></div><span className="setting-active"><Check size={14}/> Включён</span></div><div className="settings-row"><div><strong>Уведомления</strong><span>Настраиваются после подключения FCM</span></div><Bell size={17}/></div><div className="settings-row"><div><strong>Безопасность</strong><span>Настрой правила доступа в Firebase</span></div><ShieldCheck size={17}/></div>{user&&<button className="danger-btn" onClick={()=>auth&&signOut(auth)}>Выйти из аккаунта</button>}<button className="secondary-btn" onClick={()=>setNotice("Смотри README.md: архитектура, правила Firebase и план запуска.")}><CircleHelp size={16}/> Документация проекта</button></div>}
          {panel==="newgroup" && <div className="panel-content"><div className="panel-intro">Создай пространство для команды, друзей или проекта.</div><form className="panel-form" onSubmit={createGroup}><label htmlFor="group-name">Название</label><input id="group-name" value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="Например, Команда" maxLength={60} required/><button className="primary-btn"><Plus size={16}/> Создать пространство</button></form><div className="panel-form"><label htmlFor="user-search">Найти человека по имени</label><form onSubmit={searchUsers}><input id="user-search" value={userSearch} onChange={e=>setUserSearch(e.target.value)} placeholder="Имя пользователя" maxLength={40}/><button className="primary-btn" disabled={!userSearch.trim() || userSearchBusy}>{userSearchBusy?"Ищем…":"Найти"}</button></form>{userResults.map(p=><button key={p.uid} className="secondary-btn" onClick={()=>void openDirectChat(p)}>{p.displayName} · Написать</button>)}<p className="panel-footnote">В поиске показываются имя и внутренний идентификатор. Email не раскрывается.</p></div></form></div>}
          {panel==="gps" && <div className="panel-content"><div className="gps-hero"><div className="gps-icon"><MapPin size={28}/></div><h3>Геопозиция — только по запросу</h3><p>Координаты не отправляются никому автоматически. Браузер попросит разрешение.</p></div><button className="primary-btn full-btn" onClick={shareLocation} disabled={locationState==="loading"}><MapPin size={16}/>{locationState==="loading"?"Определяем…":"Определить мою позицию"}</button>{locationState==="ready"&&coords&&<div className="coordinate-card"><span>Текущие координаты</span><strong>{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</strong><p>Пока хранятся только в памяти этой страницы.</p><button className="secondary-btn" onClick={()=>{void navigator.clipboard?.writeText(`${coords.lat},${coords.lng}`);setNotice("Координаты скопированы, если браузер разрешил доступ.");}}><Copy size={15}/> Копировать координаты</button></div>}{locationState==="error"&&<p className="error-text">Не удалось получить геопозицию. Проверь разрешение браузера и HTTPS.</p>}<p className="panel-footnote">Для обмена координатами добавь отдельную кнопку «Поделиться на 15 минут», серверное истечение доступа и возможность отозвать разрешение.</p></div>}
          {panel==="calls" && <div className="panel-content"><div className="call-illustration"><div className="call-rings"><Phone size={30}/></div><h3>Аудио и видеозвонки</h3><p>Интерфейс подготовлен, но соединение ещё не реализовано.</p></div><div className="feature-note"><ShieldCheck size={18}/><div><strong>WebRTC + сигналинг</strong><p>Для настоящих звонков нужны обмен offer/answer и ICE-кандидатами, STUN/TURN и правила авторизации. Firebase сам по себе не переносит голос.</p></div></div><div className="feature-note"><Zap size={18}/><div><strong>Сначала аудио</strong><p>Аудиозвонки обычно расходуют меньше трафика, чем видео. Видео лучше включать вручную.</p></div></div><button className="secondary-btn full-btn" onClick={()=>setNotice("Звонки не запускаются в демо: нет signaling-сервера, TURN и обработки входящих вызовов.")}>Почему звонок пока недоступен?</button></div>}
        </section>
      </div>}
      <div className="toast-region" aria-live="polite">{notice && <span className="sr-only">{notice}</span>}</div>
    </div>
  );
}

function CheckCircleMini() { return <span className="traffic-check"><Check size={12}/></span>; }
