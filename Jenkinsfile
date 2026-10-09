// Build/test only. Deployments require a separately authorized operator action.
pipeline {
    agent any
    options {
        disableConcurrentBuilds()
        timeout(time: 20, unit: 'MINUTES')
    }
    stages {
        stage('Compatibility and lint') {
            steps {
                sh 'docker build --target test -t code-tk-test:$BUILD_NUMBER .'
            }
        }
        stage('Runtime image') {
            steps {
                sh 'docker build --target runner -t code-tk:$GIT_COMMIT .'
            }
        }
    }
}
