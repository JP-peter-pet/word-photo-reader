# Cloudflare Pages 배포 설정

빈 페이지가 나오지 않도록 아래 설정을 적용하세요.

## Build configuration

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **word-photo-reader** 선택
2. **Settings** → **Builds & deployments** → **Build configurations**
3. 다음처럼 설정:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. 저장 후 **Deployments**에서 **Retry deployment** 또는 새 푸시로 재배포

## 빌드가 "Building application"에서 실패할 때

1. **로컬 변경 사항을 GitHub에 푸시**한 뒤 재배포하세요.  
   (`.nvmrc`, `nixpacks.toml`, `package.json` engines가 저장소에 있어야 합니다.)
   ```bash
   git add . && git commit -m "fix: Cloudflare build (Node 20, nixpacks)" && git push origin main
   ```
2. **Build log**에서 "Building application"을 **클릭해 펼친 뒤** 빨간색으로 나오는 **에러 메시지**를 확인하세요.
3. **Environment variables** (Settings → Variables and Secrets)에 다음을 추가한 뒤 **Save** → **Retry deployment**:
   - **Variable name:** `NODE_VERSION`  
   - **Value:** `20`  
   - **Environment:** Production  
   (필요하면 `NIXPACKS_NODE_VERSION` = `20` 도 추가)
4. **Build output directory**가 `dist`로 설정돼 있는지 **Build configurations**에서 확인하세요.

## 확인

- 배포 후 https://word-photo-reader.pages.dev 새로고침 (캐시 무시: Ctrl+Shift+R / Cmd+Shift+R)
- F12 → Network 탭에서 `index-*.js`, `index-*.css` 가 200으로 로드되는지 확인
