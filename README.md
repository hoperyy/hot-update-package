```
require('hot-update-package')({
    packageName: '',
    cacheFolder: 'xxx/yyy',
    targetFolder: 'aaa/bbb',
    registry: 'xxx',
    silent: true,
    callback() {
        // hook after installed/updated
    }
});
```