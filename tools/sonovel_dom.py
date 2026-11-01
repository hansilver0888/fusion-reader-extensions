# SPDX-License-Identifier: AGPL-3.0-only
"""Small DOM bridge for offline plugin tests and optional owner-run live checks."""
import json
import sys
from bs4 import BeautifulSoup

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
client = None
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        if request['op'] == 'dom':
            soup = BeautifulSoup(request['content'], 'html5lib')
            nodes = soup.select(request['selector'])
            value = [{'text': node.get_text(), 'content': str(node), 'attributes': {
                key: ' '.join(val) if isinstance(val, list) else str(val)
                for key, val in node.attrs.items()
            }} for node in nodes]
        elif request['op'] == 'http':
            import requests
            if client is None:
                client = requests.Session()
                client.trust_env = False
            options = request['options']
            response = client.request(options.get('method', 'get'), request['url'],
                headers=options.get('headers', {}), data=options.get('data'),
                timeout=min(20, options.get('timeoutMs', 12000) / 1000))
            response.raise_for_status()
            if len(response.content) > 4 * 1024 * 1024:
                raise ValueError('Response exceeds test limit')
            value = response.content.decode('utf-8-sig')
        else:
            raise ValueError('Unsupported operation')
        print(json.dumps({'id': request['id'], 'ok': True, 'value': value}, ensure_ascii=True), flush=True)
    except Exception as exc:
        print(json.dumps({'id': request.get('id'), 'ok': False,
                          'error': type(exc).__name__ + ': test bridge failed'}), flush=True)
