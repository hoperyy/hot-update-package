```
require('hot-update-package')({
    packageName: '',
    cacheFolder: 'xxx/yyy',
    targetFolder: 'aaa/bbb',
    registry: 'xxx',
    callback() {
        // hook after installed/updated
    }
});
```