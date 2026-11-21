import { Fragment,type JSX } from "preact";
import { useEffect,useState } from "preact/hooks";
import { ApiError } from "./api";
import { refreshMe } from "./me";
import { setLang,useLang } from "./i18n";
import { useRoute } from "./router";
import { meStore } from "./store";
import { inTelegram,startParam } from "./tg";
import { ErrorState,Screen,Skeleton,Toasts } from "./ui";
import { Welcome } from "./screens/Welcome";
import { LanguagePick } from "./screens/LanguagePick";
import { ChannelGate } from "./screens/ChannelGate";
import { LazyAdminRoutes,LazyPublicPages } from "./lazy";
import { Messenger } from "./screens/Messenger";
export function applyStartRoute(){if(startParam==="profile")history.replaceState(history.state,"","#/profile");}
function AppSkeleton(){return <Screen bottom="none"><Skeleton h={56}/><Skeleton h={52}/><Skeleton h={420}/></Screen>}
export function App(){useLang();const me=meStore.use(),route=useRoute();const [error,setError]=useState<unknown>(null),[outside,setOutside]=useState(false);const load=()=>{setError(null);refreshMe().then(m=>setLang(m.lang)).catch(e=>{if(!inTelegram&&e instanceof ApiError&&e.code==="UNAUTHORIZED")setOutside(true);else setError(e)})};useEffect(load,[]);let key:string,screen:JSX.Element;if(outside){key="public";screen=<LazyPublicPages/>}else if(error){key="error";screen=<Screen bottom="none" center><ErrorState error={error} onRetry={load}/></Screen>}else if(!me){key="loading";screen=<AppSkeleton/>}else if(!me.langChosen){key="lang";screen=<LanguagePick/>}else if(!me.termsAccepted){key="welcome";screen=<Welcome/>}else if(me.channelRequired){key="gate";screen=<ChannelGate/>}else if(route.path==="/admin"||route.path.startsWith("/admin/")){key=route.path;screen=me.isAdmin?<LazyAdminRoutes parts={route.parts.length>1?route.parts.slice(1):["messaging"]} query={route.query}/>:<Messenger/>}else{key=route.path+"?"+route.query;screen=<Messenger/>}return <><Fragment key={key}>{screen}</Fragment><Toasts/></>}
