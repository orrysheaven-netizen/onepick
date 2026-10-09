# 공개 닉네임 DB 계약 (#804)

이 문서는 닉네임 저장 선행 단계의 계약이다. 앱 전 화면 전환 완료를 의미하지 않는다.

## 저장과 권한

- `public.profiles.nickname`: nullable `text`, 기본값 NULL. 선택 입력이며 기존 username/OAuth 이름을 복사하지 않는다.
- 사용자 승인에 따라 PostgreSQL `char_length` 기준 최대 15자를 DB CHECK로 강제한다. 문자 종류 제한·유일성·가입 필수 단계는 추가하지 않는다. 같은 닉네임을 여러 사용자가 쓸 수 있다.
- 프로필 생성은 기존 INSERT 컬럼을 그대로 사용한다. 닉네임은 생성 후 본인 프로필 UPDATE로 설정·수정·해제(NULL)한다.
- authenticated에 `UPDATE (nickname)`만 추가한다. 기존 `profiles_self_update`의 USING/WITH CHECK와 `reject_suspended_profile_update`를 그대로 적용한다. anon 쓰기나 테이블 전체 UPDATE는 허용하지 않는다.
- 기존 프로필 SELECT 권한·RLS를 그대로 따른다. 공개 프로필은 anon도 읽을 수 있고, 로그인 사용자의 상호 차단·정지 계정 비공개와 관리자 MFA 예외는 기존 정책대로 유지된다.
- UUID, username, 공개 프로필 URL, username 검색, 팔로우 커서와 기존 RPC 반환 필드를 변경하지 않는다. 새 SECURITY DEFINER/RPC/스냅샷을 추가하지 않는다.

## 앱 연결

1. DB 적용 후 프로필 타입/조회 projection에 `nickname: string | null`을 추가한다. `.select('*')` 이외의 명시적 컬럼 목록은 앱에서 갱신해야 한다.
2. 편집은 일반 로그인 클라이언트로 `profiles.update({ nickname }).eq('id', session.user.id).select('id,nickname').single()`을 사용한다. 저장 오류·0행 응답을 성공으로 처리하지 않고 입력을 보존한다. 중복 저장과 계정 전환 시 오래된 응답 반영을 막는다.
3. 표시명은 공통 함수로 정규화한다. 닉네임이 없거나 공백뿐이면 사람을 가리키는 문구에 `원픽 사용자`를 쓴다. username/OAuth 이름을 표시명 대체값으로 사용하지 않는다. DB는 원문 text를 보존하며 빈 입력의 NULL 변환은 편집 경로에서 처리한다.
4. 라우팅·검색·커서는 기존 username/UUID를 계속 사용한다. 닉네임으로 URL을 만들거나 사용자를 식별하지 않는다.
5. 피드·댓글·알림·팔로우·사진 등록자·관리자·공유 화면의 기존 username 반환을 닉네임으로 덮어쓰지 않는다. 기존 `item_review_page`, `pick_comment_page`/`private.comment_json`, `my_comment_page`의 프로필 JSON은 `private.public_profile_json` 명시적 allowlist를 통해 반환한다. 기존 프로필 필드(`id`, `username`, `profile_image_url`, `bio`, `onboarding_completed`, `created_at`, `updated_at`)를 유지하고 승인된 `nickname`만 명시적으로 추가한다. 자동 테이블 전체 직렬화는 사용하지 않는다. 정지·차단·삭제 작성자 보호를 유지하며 앱에서 비공개 작성자를 재조회해 복원하지 않는다. 승인된 앱 조회는 기존 RLS를 보존한다. 비공개/삭제된 콘텐츠의 작성자를 프로필 재조회로 복원하지 않는다.
6. 긴 닉네임은 화면에서 줄바꿈/말줄임으로 처리한다. 앱은 15자 초과 입력을 저장 전 거부하고 초안을 보존한다. PostgreSQL `char_length`는 Unicode 코드포인트 기준이므로 결합 이모지·자모가 화면상 한 글자처럼 보이는 경우 앱과 DB의 계산이 다를 수 있다. 공통 계산 기준을 일치시키고 경계 테스트를 추가한다. 중복 금지는 추가하지 않는다. 공유 HTML/이미지는 사용자 입력을 안전하게 이스케이프한다.
7. 홈 질문 제목·부제·참여 문구는 최신 사용자/Figma 결정을 따른다. 이 DB 변경은 문구나 레이아웃을 확정하지 않는다.

## 검증·배포

- `supabase/tests/128_public_profile_nickname.sql`: 본인 저장/해제, 다른 사용자 수정 차단, 기존 가입 흐름, 중복·Unicode·15자 허용/16자 거부, anon 읽기/쓰기, 차단·정지 사용자 보호를 검사한다.
- `supabase/tests/129_profile_nickname_rpc_contract.sql`: 리뷰·댓글·내 댓글의 필드 allowlist, 공개 닉네임, 정지·차단·삭제 작성자 보호와 helper 직접 호출 제한을 검증한다.
- 전체 Database Tests CI와 Claude 독립 리뷰를 통과한 뒤 사용자 병합 승인 → 공식 DB dry-run → 별도 운영 적용 승인 순서로 진행한다.
- 앱 릴리스는 운영 DB 컬럼 적용 후 진행한다. 컬럼이 없는 환경에서 새 컬럼을 조회하면 API 오류가 나므로 배포 순서를 지킨다.
- 롤백은 우선 앱의 새 필드 사용을 되돌린다. 저장된 닉네임을 보존하기 위해 컬럼을 즉시 삭제하지 않는다. 권한 회수나 파괴적 데이터 변경은 별도 검토·승인한다.
