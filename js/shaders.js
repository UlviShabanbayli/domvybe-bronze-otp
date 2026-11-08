// DV90 BRONZE OTP · shaders. Both canvases work in "stage" coordinates: CSS px from the plate's top-left corner, y down.
//   PLATE_FS — cast-iron plate, bezels, sand moulds, the cast bronze faces (crust, cracks, temper film, patina),
//              the pour ribbon and meniscus, the digit's drop shadow and chamfer wall, heat glow on iron and page.
//   METAL_FS — only the digit faces (the canvas is clipped by SVG <text>, so every glyph edge is vector-sharp):
//              raised polished bronze with a chamfer, hot emission, temper film, neighbour glow, success sweep.

const COMMON = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uS; uniform vec2 uOff;
uniform vec4 uSlot[6];   // cx, cy, w, h
uniform vec4 uSt[6];     // level, temperature, temper film, digit visibility
uniform vec4 uSx[6];     // digit (-1 none), ribbon head, ribbon tail, error flash
uniform vec4 uGeo;       // font px, baseline offset from the slot centre, bezel width, bezel radius
uniform vec4 uPlate;     // x, y, w, h
uniform vec4 uPl2;       // plate radius, tile width, idle drift, 0
uniform vec4 uLight;     // pointer light x, y, strength, height
uniform vec4 uFx;        // time, success sweep (-1 off), error, cold (locked)
uniform vec4 uCam;       // camera x, y, z, exposure
uniform vec2 uEnv;       // soft-box shift (pointer / idle drift)
uniform vec4 uAtl; uniform vec2 uAtlSize;
uniform sampler2D uAtlas; uniform sampler2D uNoise;
out vec4 o;

float sdRR(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return length(max(q,0.0))+min(max(q.x,q.y),0.0)-r; }
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float rectS(vec2 a, vec4 b, float s){ vec2 lo=smoothstep(b.xy-s,b.xy+s,a); vec2 hi=1.0-smoothstep(b.zw-s,b.zw+s,a); return lo.x*lo.y*hi.x*hi.y; }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
vec3 blackbody(float T){
  vec3 c=mix(vec3(0.0), vec3(0.40,0.025,0.0), smoothstep(0.06,0.30,T));
  c=mix(c, vec3(1.0,0.16,0.015), smoothstep(0.26,0.58,T));
  c=mix(c, vec3(1.0,0.36,0.06), smoothstep(0.56,0.82,T));
  c=mix(c, vec3(1.0,0.66,0.28), smoothstep(0.82,0.97,T));
  c=mix(c, vec3(1.0,0.90,0.70), smoothstep(0.97,1.1,T));
  return c;
}
// thin-film temper colours (straw → bronze → purple → blue), phase in 0..1
vec3 film(float ph){ return 0.5+0.5*cos(6.2832*(ph*vec3(1.0,0.86,0.72)+vec3(0.0,0.24,0.5))); }
vec4 atl(vec2 q, float d){                    // q: px from (slot centre x, baseline)
  vec2 a=q*(uAtl.z/uGeo.x)+vec2(uAtl.x*0.5, uAtl.w);
  if(d<0.0||a.x<1.0||a.y<1.0||a.x>uAtl.x-1.0||a.y>uAtl.y-1.0) return vec4(0.0);
  return texture(uAtlas, vec2((d*uAtl.x+a.x)/uAtlSize.x, a.y/uAtlSize.y));
}
// studio: a big warm key soft box upper-left, a strip across the top, a warm card right, a dim floor bounce
vec3 env(vec3 r, float rough){
  vec2 a=r.xy/(r.z+1.0)+uEnv;
  float s=0.025+rough*0.55;
  vec3 c=vec3(0.010,0.008,0.006);
  c+=vec3(0.30,0.24,0.17)*exp(-dot(a-vec2(-0.16,-0.22),a-vec2(-0.16,-0.22))*(5.5-rough*3.0));
  c+=vec3(1.0,0.90,0.76)*2.0*rectS(a, vec4(-0.62,-0.62,-0.18,-0.30), s);
  c+=vec3(1.0,0.95,0.86)*1.5*rectS(a, vec4(-0.95,-0.78,0.95,-0.66), s*0.6);
  c+=vec3(1.0,0.62,0.32)*0.55*rectS(a, vec4(0.30,-0.25,0.80,0.40), s+0.05);
  c+=vec3(0.38,0.30,0.24)*0.12*smoothstep(0.25,0.8,a.y);
  return c;
}
// the liquid surface inside a mould (y down: metal is where q.y > surf)
float surf(vec2 q, vec4 S, float L, vec4 sx, float t){
  float hb=S.w*0.5-uGeo.z;
  float ys=hb-L*2.0*hb;
  float mov=clamp(L*(1.0-L)*4.0,0.0,1.0);
  ys+=S.w*(0.016*sin(q.x*6.3/S.z+t*7.0)+0.009*sin(q.x*14.0/S.z-t*11.0))*mov;
  float rib=step(0.001,sx.y)*(1.0-sx.z);
  ys-=S.w*0.03*rib*exp(-pow(q.x/(0.16*S.z),2.0))*(0.65+0.35*sin(t*23.0))*step(L,0.995);
  if(L>=0.999) ys=-S.w;
  return ys;
}
vec3 pointerSpec(vec3 P, vec3 n, vec3 V, vec3 F, float rough){
  vec3 Lp=vec3(uLight.xy,uLight.w)-P; float dl=length(Lp); Lp/=dl;
  vec3 H=normalize(Lp+V);
  float k=mix(900.0,24.0,rough);
  return F*pow(max(dot(n,H),0.0),k)*mix(9.0,0.6,rough)*uLight.z;
}
vec3 finish(vec3 col, vec2 fc){
  col=aces(col*uCam.w);
  col=pow(col, vec3(1.0/2.2));
  return col+(hash12(fc+fract(uFx.x)*71.0)-0.5)/255.0*1.5;
}
`;

export const PLATE_FS = COMMON + `
vec3 hotFace(vec2 q, float T, float tw, float t, float seed, out float crackOut){
  vec2 uv=q/(tw*2.4)+seed*0.37;
  vec2 wv=vec2(texture(uNoise, uv*0.8+vec2(0.0,-t*0.01)).g, texture(uNoise, uv*0.8+vec2(0.5,t*0.008)).b)-0.5;
  float n1=texture(uNoise, uv*0.55+wv*0.18+vec2(0.0,-t*0.012)).g;
  float n2=texture(uNoise, uv*1.25+wv*0.25+vec2(t*0.009,0.02)).b;
  float w=n1*0.62+n2*0.38;
  float cw=mix(0.010,0.04,smoothstep(0.3,1.0,T));
  float rd=abs(w-0.5);
  float c1=1.0-smoothstep(0.0,cw,rd);
  float r2=abs(texture(uNoise, uv*2.6+wv*0.3+vec2(0.31,0.77)).b-0.5);
  float c2=1.0-smoothstep(0.0,cw*0.6,r2);
  float crack=max(c1,c2*0.7);
  float halo=max(1.0-smoothstep(0.0,cw*4.5,rd), (1.0-smoothstep(0.0,cw*3.0,r2))*0.6);
  crackOut=crack;
  float skin=smoothstep(1.0,0.72,T);
  float blot=texture(uNoise, uv*0.9+vec2(0.13,0.41)).a;
  float liquid=T*(0.70+0.16*w+0.10*halo);
  float crust=T*(0.30+0.2*w+0.12*blot)+T*0.30*halo;
  float Tc=mix(liquid, max(crust, min(1.0,T*1.18+0.04)*crack), skin)*0.92;
  return blackbody(Tc)*(0.03+1.5*pow(Tc,3.2));
}
// the pour: one continuous ribbon of molten bronze from the gate down to the rising surface (never drops)
float ribbon(vec2 q, vec4 S, vec4 sx, float ys, float t){
  float head=sx.y, tail=sx.z;
  if(head<=0.0 || tail>=1.0) return 0.0;
  float top=-S.w*0.5;
  float bot=mix(top, ys, head);
  float y0=mix(top, ys, tail*tail);
  if(q.y<y0 || q.y>bot+1.0) return 0.0;
  float k=clamp((q.y-top)/S.w,0.0,1.0);
  float xc=S.z*0.010*sin(q.y*0.045+t*6.0);
  float wr=S.z*mix(0.072,0.050,k)*(1.0+0.10*sin(q.y*0.11-t*19.0));
  wr*=(tail>0.0?smoothstep(y0, y0+S.w*0.10, q.y):1.0)*(1.0-0.5*tail)+0.0001;
  return 1.0-smoothstep(wr*0.55, wr, abs(q.x-xc));
}

void main(){
  vec2 p=vec2(gl_FragCoord.x, uRes.y-gl_FragCoord.y)/uS+uOff;
  float t=uFx.x, tw=uPl2.y, R=uPl2.x;
  vec2 pc=uPlate.xy+uPlate.zw*0.5, ph=uPlate.zw*0.5;
  float pd=sdRR(p-pc, ph, R);
  vec3 P=vec3(p,0.0);
  vec3 V=normalize(uCam.xyz-P);

  // nearest mould
  int k=0; float best=1e9;
  for(int i=0;i<6;i++){ vec4 S=uSlot[i]; float d=sdRR(p-S.xy, S.zw*0.5, uGeo.w); if(d<best){ best=d; k=i; } }
  vec4 S=uSlot[k], st=uSt[k], sx=uSx[k];
  vec2 q=p-S.xy;
  float d=best, rw=uGeo.z;

  // heat glow from every hot mould (lights iron, bezels, neighbours, the page)
  vec3 glowLit=vec3(0.0), glowOut=vec3(0.0);
  for(int i=0;i<6;i++){
    vec4 Si=uSlot[i], si=uSt[i];
    float Ti=si.y*min(1.0,si.x*1.4+uSx[i].y*0.4);
    if(Ti>0.01){
      vec2 dv=p-Si.xy; float dd2=dot(dv,dv)/(Si.z*Si.z);
      vec3 c=blackbody(min(Ti,1.0))*pow(Ti,2.2);
      glowLit+=c/(1.0+dd2*3.0);
      glowOut+=c*(0.42*exp(-dd2*1.0)+0.10*exp(-dd2*0.22));
    }
  }

  vec3 col;
  float alphaIn=1.0;
  // ---------------- inside the plate ----------------
  vec3 n=vec3(0.0,0.0,1.0);
  vec2 nuv=p/(tw*2.6);
  float g0=texture(uNoise,nuv).r, gx=texture(uNoise,nuv+vec2(1.0/256.0,0.0)).r, gy=texture(uNoise,nuv+vec2(0.0,1.0/256.0)).r;
  vec2 grain=vec2(g0-gx, g0-gy);
  float L=st.x, T=st.y, tn=st.z, vis=st.w;
  float ys=surf(q, S, L, sx, t);
  bool gate=abs(q.x)<S.z*0.05 && q.y<0.0 && d>-rw-1.0 && d<0.0;
  bool cav=d<-rw || gate;
  bool ring=!cav && d<=0.0;
  float filled=0.0;

  if(cav){
    float dc=gate?0.0:-(d+rw);
    float ao=smoothstep(0.0,0.16*tw,dc);
    bool metal=L>0.001 && q.y>ys && (!gate || L>0.97);
    if(metal){
      filled=1.0;
      // the cast face: sand-cast skin, a concave fillet at the walls
      vec2 fq=q/(tw*1.9)+float(k)*0.29;
      float pat=texture(uNoise,fq*0.6).a;
      n.xy+=grain*0.8+vec2(texture(uNoise,fq*3.0).g-0.5, texture(uNoise,fq*3.0+0.5).b-0.5)*0.10;
      vec2 gd=vec2(sdRR(q+vec2(1.0,0.0),S.zw*0.5,uGeo.w)-sdRR(q-vec2(1.0,0.0),S.zw*0.5,uGeo.w), sdRR(q+vec2(0.0,1.0),S.zw*0.5,uGeo.w)-sdRR(q-vec2(0.0,1.0),S.zw*0.5,uGeo.w))*0.5;
      float fil=1.0-smoothstep(0.0,0.05*tw,dc);
      n.xy+=gd*fil*0.9;
      // molten swell while hot
      n.xy+=T*0.18*vec2(sin(q.x*0.05+t*1.9+q.y*0.03), cos(q.y*0.06-t*1.6));
      // the digit: drop shadow down-right and the chamfer wall
      float dg=sx.x, shade=1.0, wall=0.0;
      vec2 dir=vec2(0.62,0.78);
      vec2 qb=q-vec2(0.0,uGeo.y);
      if(dg>=0.0 && vis>0.001){
        float ext=uGeo.x*0.028;
        float w1=atl(qb-dir*ext*0.4,dg).g, w2=atl(qb-dir*ext*0.75,dg).g, w3=atl(qb-dir*ext,dg).g;
        wall=smoothstep(0.35,0.6,max(w1,max(w2,w3)))*vis;
        float sd=atl(qb-dir*uGeo.x*0.075,dg).b;
        shade=1.0-0.72*min(1.0,sd*1.1)*vis;
        float sd2=atl(qb-dir*uGeo.x*0.02,dg).a;
        shade*=1.0-0.35*min(1.0,sd2)*vis;
      }
      vec3 F0=vec3(0.42,0.235,0.115)*(0.62+0.6*pat);
      F0=mix(F0, vec3(0.42,0.34,0.20), smoothstep(0.55,0.9,texture(uNoise,fq*1.7).a)*0.6);
      float famp=smoothstep(0.0,0.14,tn)*(1.0-smoothstep(0.55,1.0,tn));
      float ph=0.10+0.45*texture(uNoise,fq*0.45+0.5).a+q.y/S.w*0.22+(1.0-tn)*0.75;
      F0=mix(F0, film(ph)*vec3(0.60,0.56,0.50), famp*0.85);
      float rough=0.42-0.12*famp;
      if(wall>0.0){
        n=normalize(mix(normalize(n), normalize(vec3(dir*1.2,0.5)), wall));
        F0=mix(F0, vec3(0.80,0.55,0.32), wall*0.85); rough=mix(rough,0.2,wall);
        shade=mix(shade,1.0,wall);
      }
      n=normalize(n);
      vec3 r=reflect(-V,n);
      float cv=max(dot(n,V),0.0);
      vec3 F=F0+(1.0-F0)*pow(1.0-cv,5.0)*0.5;
      col=env(r,rough)*F*shade;
      col+=pointerSpec(P,n,V,F,rough)*shade*0.22;
      col*=mix(0.45,1.0,ao);
      col+=glowLit*F*0.05;
      // heat: liquid, crust with glowing cracks, cooling to metal
      if(T>0.003){
        float cr; vec3 em=hotFace(q, T, tw, t, float(k), cr);
        float wallHot=wall*0.9;
        em=mix(em, blackbody(pow(T,0.8)*0.96)*(0.05+1.6*pow(T,2.6)), wallHot);
        em*=mix(0.75,1.0,ao)*mix(1.0,0.82,(1.0-shade)*(1.0-wall));
        col=col*(1.0-0.92*smoothstep(0.1,0.55,T))+em;
        // liquid metal is a mirror: the soft boxes glide on the molten pool until the crust forms
        float liq=1.0-smoothstep(1.0,0.74,T);
        vec3 nl=normalize(vec3(n.xy*0.35,1.0));
        col+=env(reflect(-V,nl),0.04)*vec3(1.0,0.62,0.32)*0.24*liq*(1.0-wall);
      }
      // meniscus line while the level moves
      float mov=clamp(L*(1.0-L)*4.0,0.0,1.0);
      col+=blackbody(0.92)*1.2*exp(-pow((q.y-ys)/(0.012*S.w),2.0))*mov;
    } else {
      // empty mould: dark green sand, deeper at the walls
      vec2 sq=p/(tw*0.55);
      float s1=texture(uNoise,sq).r, s2=hash12(floor(p*uS*0.7));
      vec3 alb=vec3(0.050,0.042,0.032)*(0.55+0.55*s1+0.25*s2);
      n.xy+=grain*1.4; n=normalize(n);
      vec3 Lk=normalize(vec3(-0.45,-0.6,0.66));
      float ndl=max(dot(n,Lk),0.0);
      col=alb*(0.05+0.55*ndl)*mix(0.18,1.0,ao);
      col+=env(reflect(-V,n),0.9)*0.012*ao;
      if(gate) col*=0.35;
    }
  } else if(ring){
    // the bezel: a raised half-round lip; iron while empty, polished bronze once the metal reaches it
    float u=clamp((d+rw*0.5)/(rw*0.5),-0.985,0.985);
    float sl=-u/sqrt(1.0-u*u)*0.75;
    vec2 gd=vec2(sdRR(q+vec2(1.0,0.0),S.zw*0.5,uGeo.w)-sdRR(q-vec2(1.0,0.0),S.zw*0.5,uGeo.w), sdRR(q+vec2(0.0,1.0),S.zw*0.5,uGeo.w)-sdRR(q-vec2(0.0,1.0),S.zw*0.5,uGeo.w))*0.5;
    n.xy=-gd*sl+grain*0.5; n=normalize(n);
    float bz=smoothstep(ys-2.0, ys+2.0, q.y)*step(0.001,L);
    vec3 F0=mix(vec3(0.10,0.095,0.088), vec3(0.95,0.68,0.42), bz);
    float rough=mix(0.42,0.16,bz);
    vec3 r=reflect(-V,n);
    float cv=max(dot(n,V),0.0);
    vec3 F=F0+(1.0-F0)*pow(1.0-cv,5.0)*0.6;
    col=env(r,rough)*F;
    col+=pointerSpec(P,n,V,F,rough);
    // its own heat and the neighbours' glow on the polished lip
    col+=glowLit*F*(0.35+0.9*max(-dot(n.xy,normalize(q+1e-4)),0.0));
    if(bz>0.0 && T>0.003){
      float cr; vec3 em=hotFace(q, T*0.92, tw, t, float(k)+0.5, cr);
      col=col*(1.0-0.9*bz*smoothstep(0.1,0.55,T))+em*bz*0.85;
    }
    filled=bz;
  } else {
    // cast-iron plate: fine grain, a beveled edge catching the key, the light pool from above
    float bev=0.07*tw;
    if(pd>-bev){
      float u=clamp((pd+bev)/bev,0.0,0.97);
      vec2 gp=vec2(sdRR(p-pc+vec2(1.0,0.0),ph,R)-sdRR(p-pc-vec2(1.0,0.0),ph,R), sdRR(p-pc+vec2(0.0,1.0),ph,R)-sdRR(p-pc-vec2(0.0,1.0),ph,R))*0.5;
      n.xy+=gp*(u/sqrt(1.0-u*u))*0.9;
    }
    n.xy+=grain*0.38;
    // shallow lip around each bezel (the iron is cast up to it)
    float lip=1.0-smoothstep(0.0,0.035*tw,d);
    vec2 gd=vec2(sdRR(q+vec2(1.0,0.0),S.zw*0.5,uGeo.w)-sdRR(q-vec2(1.0,0.0),S.zw*0.5,uGeo.w), sdRR(q+vec2(0.0,1.0),S.zw*0.5,uGeo.w)-sdRR(q-vec2(0.0,1.0),S.zw*0.5,uGeo.w))*0.5;
    n.xy-=gd*lip*0.35;
    n=normalize(n);
    vec3 F0=vec3(0.052,0.048,0.044);
    float rough=0.5+0.12*texture(uNoise,p/(tw*3.0)).a;
    vec3 r=reflect(-V,n);
    float cv=max(dot(n,V),0.0);
    vec3 F=F0+(1.0-F0)*pow(1.0-cv,5.0)*0.4;
    float pool=exp(-pow(length((p-pc-vec2(0.0,-ph.y*0.5))/vec2(ph.x*1.15,ph.y*2.0)),2.0));
    col=env(r,rough)*F*(0.35+0.8*pool);
    col+=vec3(0.010,0.0085,0.007)*max(dot(n,normalize(vec3(-0.4,-0.7,0.6))),0.0)*(0.6+pool);
    col+=pointerSpec(P,n,V,F,rough)*0.7;
    col*=0.55+0.45*smoothstep(0.0,0.05*tw,d);            // occlusion against the bezel
    col+=glowLit*(0.035+0.16*F.r);
  }
  // the pour ribbon (in front of the mould, over the gate)
  if(sx.y>0.0 && d<0.5){
    float rb=ribbon(q, S, sx, ys, t);
    if(rb>0.0){
      float xc=S.z*0.010*sin(q.y*0.045+t*6.0);
      float fl=texture(uNoise, vec2(q.x*0.004, q.y*0.0035-t*0.9)).g;
      float Tr=0.9-0.16*smoothstep(0.0,S.z*0.05,abs(q.x-xc))+0.08*(fl-0.5);
      vec3 em=blackbody(Tr)*(0.2+1.6*pow(Tr,3.0));
      col=mix(col, em, rb);
    }
    // its glow on the sand and the bezel
    float top=-S.w*0.5, xc2=S.z*0.010*sin(q.y*0.045+t*6.0);
    float on=step(top,q.y)*step(q.y, mix(top,ys,sx.y))*(1.0-sx.z);
    col+=blackbody(0.8)*0.35*exp(-pow((q.x-xc2)/(S.z*0.09),2.0))*on*(1.0-rb);
  }
  // success: a golden light sweeps across the plate
  if(uFx.y>=0.0){
    float sw=(p.x+p.y*0.35-uPlate.x)/(uPlate.z+uPlate.w*0.35);
    float band=exp(-pow((sw-uFx.y*1.5+0.25)/0.07,2.0));
    col+=vec3(1.0,0.78,0.45)*band*(0.06+0.16*filled);
  }
  // error: the metal flashes dull red
  col=mix(col, col*vec3(1.25,0.45,0.35)+vec3(0.30,0.03,0.005), sx.w*filled*0.85);
  // locked: the plate goes cold
  float lum=dot(col,vec3(0.3,0.55,0.15));
  col=mix(col, vec3(lum)*vec3(0.78,0.80,0.86)*0.55, uFx.w*0.8);

  vec3 inside=finish(col, gl_FragCoord.xy);

  // ---------------- outside: soft shadow + heat glow on the page (premultiplied) ----------------
  vec2 cpx=gl_FragCoord.xy/uS, cwh=uRes/uS;
  float edge=min(min(cpx.x,cwh.x-cpx.x),min(cpx.y,cwh.y-cpx.y));
  float fade=smoothstep(0.0,0.42*tw,edge);
  float shd=(1.0-smoothstep(-0.30*tw,0.40*tw,sdRR(p-pc-vec2(0.0,0.10*tw), ph, R)))*0.78*fade;
  shd=max(shd,(1.0-smoothstep(-0.02*tw,0.08*tw,pd))*0.6);
  vec3 g=glowOut*(1.0-uFx.w)*fade;
  g=1.0-exp(-g*1.2);
  float aa=clamp(0.5-pd*uS,0.0,1.0);
  vec4 outside=vec4(g, shd);
  o=mix(outside, vec4(inside,1.0), aa);
}
`;

export const METAL_FS = COMMON + `
void main(){
  vec2 p=vec2(gl_FragCoord.x, uRes.y-gl_FragCoord.y)/uS+uOff;
  int k=-1;
  for(int i=0;i<6;i++){ vec4 s=uSlot[i]; if(abs(p.x-s.x)<s.z*0.5 && abs(p.y-s.y)<s.w*0.5) k=i; }
  if(k<0){ o=vec4(0.0); return; }
  vec4 S=uSlot[k], st=uSt[k], sx=uSx[k];
  float dg=sx.x, vis=st.w;
  if(dg<0.0 || vis<0.002){ o=vec4(0.0); return; }
  vec2 q=p-S.xy, qb=q-vec2(0.0,uGeo.y);
  vec4 A=atl(qb,dg);
  if(A.r<0.002){ o=vec4(0.0); return; }
  float t=uFx.x, tw=uPl2.y;
  float L=st.x, T=st.y, tn=st.z;
  float ys=surf(q, S, L, sx, t);
  float lv=smoothstep(ys-1.0, ys+1.5, q.y);
  float a=vis*lv;
  if(a<0.002){ o=vec4(0.0); return; }

  // relief: chamfer (G) over a rounded body (A); normal from four taps, 1 CSS px apart
  float e=1.0, Hpx=uGeo.x*0.05;
  float hx0=atl(qb-vec2(e,0.0),dg).g*0.7+atl(qb-vec2(e,0.0),dg).a*0.3;
  float hx1=atl(qb+vec2(e,0.0),dg).g*0.7+atl(qb+vec2(e,0.0),dg).a*0.3;
  float hy0=atl(qb-vec2(0.0,e),dg).g*0.7+atl(qb-vec2(0.0,e),dg).a*0.3;
  float hy1=atl(qb+vec2(0.0,e),dg).g*0.7+atl(qb+vec2(0.0,e),dg).a*0.3;
  vec2 gr=vec2(hx1-hx0, hy1-hy0)/(2.0*e)*Hpx;
  vec2 nuv=p/(tw*2.6);
  float g0=texture(uNoise,nuv*2.0).r, gx=texture(uNoise,nuv*2.0+vec2(1.0/256.0,0.0)).r;
  vec3 n=normalize(vec3(-gr*3.2+vec2(g0-gx,0.0)*0.25*(1.0-tn), 1.0));
  vec3 P=vec3(p, Hpx*(A.g*0.7+A.a*0.3));
  vec3 V=normalize(uCam.xyz-P);
  vec3 r=reflect(-V,n);
  float cv=max(dot(n,V),0.0);
  float core=smoothstep(0.55,1.0,A.a);
  vec3 F0=vec3(0.98,0.74,0.46);
  float famp=smoothstep(0.0,0.14,tn)*(1.0-smoothstep(0.55,1.0,tn));
  float ph=0.10+0.4*texture(uNoise,q/(tw*3.0)+float(k)*0.31).a+q.y/S.w*0.4+(1.0-tn)*0.75;
  F0=mix(F0, film(ph)*vec3(0.95,0.85,0.72), famp*0.35);
  float rough=0.07+0.05*(1.0-core)+0.08*famp;
  vec3 F=F0+(1.0-F0)*pow(1.0-cv,5.0)*0.6;
  vec3 col=env(r,rough)*F;
  col+=pointerSpec(P,n,V,F,rough);
  // neighbours' molten glow reflected in the polish
  for(int i=0;i<6;i++){
    if(i==k) continue;
    vec4 Si=uSlot[i], si=uSt[i];
    float Ti=si.y*min(1.0,si.x*1.4+uSx[i].y*0.4);
    if(Ti>0.01){
      vec3 dl=vec3(Si.xy,tw*0.3)-P; float dd=length(dl); dl/=dd;
      vec3 c=blackbody(min(Ti,1.0))*pow(Ti,2.2);
      float fall=1.0/(1.0+pow(dd/(Si.z*1.2),2.0));
      col+=c*F*fall*(0.25*max(dot(n,dl),0.0)+1.6*pow(max(dot(n,normalize(dl+V)),0.0),40.0));
    }
  }
  // heat: the numeral stays hotter than the face (a glowing figure in the crust), core hottest
  if(T>0.003){
    float Td=pow(T,0.78)*mix(0.86,1.0,core);
    vec3 em=blackbody(Td*0.98)*(0.04+1.55*pow(Td,2.8));
    col=col*(1.0-0.95*smoothstep(0.08,0.5,T))+em;
  }
  // success sweep
  if(uFx.y>=0.0){
    float sw=(p.x+p.y*0.35-uPlate.x)/(uPlate.z+uPlate.w*0.35);
    float band=exp(-pow((sw-uFx.y*1.5+0.25)/0.06,2.0));
    col+=vec3(1.0,0.82,0.52)*band*(0.8+1.6*pow(max(dot(n,normalize(vec3(-0.3,-0.4,1.0))),0.0),8.0));
  }
  col=mix(col, col*vec3(1.2,0.45,0.35)+vec3(0.45,0.05,0.01), sx.w*0.85);
  float lum=dot(col,vec3(0.3,0.55,0.15));
  col=mix(col, vec3(lum)*vec3(0.78,0.80,0.86)*0.55, uFx.w*0.8);
  o=vec4(finish(col, gl_FragCoord.xy)*a, a);
}
`;
