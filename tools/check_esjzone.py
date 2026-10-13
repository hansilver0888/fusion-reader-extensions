"""Optional live source check. Credentials arrive through stdin, never reports.

Requires requests and beautifulsoup4. Does not run in repository CI or save pages.
The JavaScript source uses the same request and CSS bridge shapes as the app.
"""
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse

from bs4 import BeautifulSoup
import requests


def element(node):
    if node is None:
        return {}
    attributes = {key: ' '.join(value) if isinstance(value, list) else value for key, value in node.attrs.items()}
    return dict(text=node.get_text(), content=str(node), attributes=attributes)


def main():
    credentials = json.loads(sys.stdin.read())
    assert credentials.get('email') and credentials.get('password'), 'Test login credentials are missing.'
    session = requests.Session()
    session.headers['User-Agent'] = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                                     '(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')
    root = Path(__file__).resolve().parents[1]
    process = subprocess.Popen(['node', str(root / 'tools/check_esjzone.mjs')], cwd=root,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding='utf-8')
    result = None
    count = 0
    try:
        for line in process.stdout:
            call = json.loads(line)
            channel = call['channel']
            if channel == 'done':
                result = call['result']
                break
            payload = call.get('payload', {})
            try:
                if channel == 'registerSetting':
                    data = None
                elif channel == 'getSetting':
                    data = credentials.get(payload['key'], '')
                elif channel == 'request':
                    assert urlparse(payload['url']).hostname == 'www.esjzone.cc', 'Unexpected authenticated host.'
                    options = payload.get('options', {})
                    response = session.request(options.get('method', 'get'), payload['url'],
                                               data=options.get('data'), headers=options.get('headers'), timeout=25)
                    count += 1
                    if not options.get('allowErrorStatus'):
                        response.raise_for_status()
                    data = response.text
                elif channel in ('querySelector', 'querySelectorAll', 'getAttributeText'):
                    document = BeautifulSoup(payload['content'], 'html.parser')
                    if channel == 'querySelectorAll':
                        data = [element(node) for node in document.select(payload['selector'])]
                    else:
                        node = document.select_one(payload['selector'])
                        data = node.get(payload['attr']) if channel == 'getAttributeText' and node else None
                        if channel == 'querySelector':
                            data = element(node)
                elif channel == 'probeImage':
                    # Match the app's normal image headers, without site login cookies.
                    response = requests.get(payload['url'], headers={'User-Agent': session.headers['User-Agent']},
                                            timeout=25, stream=True)
                    first = next(response.iter_content(8192), b'')
                    image = first.startswith((b'\xff\xd8\xff', b'\x89PNG', b'GIF8')) or first.startswith(b'RIFF') and first[8:12] == b'WEBP'
                    data = dict(status=response.status_code, imageBytes=bool(image))
                    response.close()
                else:
                    raise ValueError('Unsupported test bridge channel: ' + channel)
                reply = dict(id=call['id'], ok=True, data=data)
            except Exception as error:
                message = str(error).replace(credentials['email'], '[account]').replace(credentials['password'], '***')
                reply = dict(id=call['id'], ok=False, data=message)
            process.stdin.write(json.dumps(reply, ensure_ascii=True) + '\n')
            process.stdin.flush()
        process.stdin.close()
        process.wait(timeout=10)
        assert result is not None, 'Source test did not return a result.'
        result['requests'] = count
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get('ok') else 1
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)
        session.close()
        credentials.clear()


if __name__ == '__main__':
    raise SystemExit(main())
