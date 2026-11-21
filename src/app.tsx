import { Fragment, type JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ApiError } from "./api";
import { refreshMe } from "./me";
import { setLang, useLang } from "./i18n";
import { useRoute } from "./router";
import { meStore } from "./store";
import { inTelegram, startParam } from "./tg";
import { ErrorState, Screen, Skeleton, SkeletonGrid, Toasts } from "./ui";
import { ArtGallery } from "./art";
import { Welcome } from "./screens/Welcome";
import { LanguagePick } from "./screens/LanguagePick";
import { ChannelGate } from "./screens/ChannelGate";
import { LazyAdminRoutes, LazyPublicPages } from "./lazy";
import { Messenger } from "./screens/Messenger";
function routeFromStartParam(p: string | null): string | null {
 if (!p) return null;
 if (p === "profile") return "/profile";
 return null;
}
export function applyStartRoute() {
 const deep=routeFromStartParam(startParam);
 if(deep&&(location.hash===""||location.hash==="#/"))history.replaceState(history.state,"","#"+deep);
}
function AppSkeleton(){return <Screen bottom="none"><Skeleton h={236} radius={24}/><Skeleton h={44}/><div class="card"><SkeletonGrid/></div></Screen>}
export function App(){
 useLang();const me=meStore.use(),route=useRoute();const [error,setError]=useState<unknown>(null),[outside,setOutside]=useState(false);
 const load=()=>{setError(null);refreshMe().then(m=>setLang(m.lang)).catch(e=>{if(!inTelegram&&e instanceof ApiError&&e.code==="UNAUTHORIZED")setOutside(true);else setError(e)});};
 useEffect(load,[]);
 let key:string,screen:JSX.Element;
 if(import.meta.env.DEV&&route.path==="/__art"){key="__art";screen=<ArtGallery/>;}
 else if(outside||(import.meta.env.DEV&&route.path==="/__public")){key="public";screen=<LazyPublicPages/>;}
 else if(error){key="error";screen=<Screen bottom="none" center><ErrorState error={error} onRetry={load}/></Screen>;}
 else if(!me){key="loading";screen=<AppSkeleton/>;}
 else if(!me.langChosen){key="lang";screen=<LanguagePick/>;}
 else if(!me.termsAccepted){key="welcome";screen=<Welcome/>;}
 else if(me.channelRequired){key="gate";screen=<ChannelGate/>;}
 else if(route.parts[0]==="admin"&&me.isAdmin){key=route.path+"?"+route.query;screen=<LazyAdminRoutes parts={route.parts.slice(1)} query={route.query}/>;}
 else {key=route.path+"?"+route.query;screen=<Messenger/>;}
 return <><Fragment key={key}>{screen}</Fragment><Toasts/></>;
}
