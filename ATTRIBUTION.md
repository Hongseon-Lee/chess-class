# 외부 자산 저작권 표시

## chess.js 1.4.0

- 출처: https://github.com/jhlywa/chess.js
- 라이선스: BSD 2-Clause. 전문은 `js/vendor/chess.js` 파일 안에 그대로 들어 있다.
- 위치: `js/vendor/chess.js`
- 수정하지 않고 그대로 포함한다. 갱신할 때는 jsdelivr에서 다시 받는다.

Copyright (c) Jeff Hlywa

## 체스 기물 SVG (Cburnett 세트)

- 출처: Wikimedia Commons, 저작자 Cburnett (Colin M.L. Burnett)와 그 뒤에 파일을 다듬은 기여자들
  https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces
- 라이선스: BSD 3-Clause (저작자가 GFDL / CC BY-SA 3.0 / GPL / BSD 3-Clause로
  다중 배포한 것 중 BSD 3-Clause를 선택해 사용한다)
- 위치: `img/pieces/Chess_*45.svg`
- 수정하지 않고 그대로 포함한다.

아래는 각 파일의 Wikimedia Commons 설명 페이지에 실린 라이선스 문구다. "The author"는 위의 저작자를 가리킨다.

```
Copyright © The author

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of
conditions and the following disclaimer.
Redistributions in binary form must reproduce the above copyright notice, this list of
conditions and the following disclaimer in the documentation and/or other materials
provided with the distribution.
Neither the name of The author nor the names of its contributors may be used to endorse
or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
THE AUTHOR AND CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Lichess 퍼즐 데이터

- 출처: https://database.lichess.org/
- 라이선스: CC0 (표시 의무 없음. 예의상 기록한다)
- 위치: `data/puzzles/mateIn1.json`, `data/puzzles/mateIn2.json` — 2026-10-02 판에서 `tools/build_puzzles.py`로
  1수 외통 300문제, 2수 외통 200문제를 골랐다. 문제의 판과 수순, 레이팅, id는 고치지 않았다.
