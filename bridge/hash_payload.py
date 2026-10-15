import hashlib
import os


def payload_digest(root):
    hasher = hashlib.sha256()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in sorted(dirnames) if name != '__pycache__']
        for name in sorted(filenames):
            if name == 'payload.hash' or name.endswith('.pyc'):
                continue
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, root).replace('\\', '/')
            hasher.update(rel.encode('utf-8'))
            hasher.update(b'\0')
            with open(path, 'rb') as handle:
                hasher.update(handle.read())
            hasher.update(b'\0')
    return hasher.hexdigest()


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    digest = payload_digest(here)
    with open(os.path.join(here, 'payload.hash'), 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(digest + '\n')
    print(digest)
